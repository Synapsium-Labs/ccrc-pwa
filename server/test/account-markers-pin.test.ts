// The account markers' characterization pin (D-7048; ARCH-72, Task C5a; plan
// 2026-10-26-consolidation-arch43-arch72-accounts.md; spec K16, §5.1 rule 1). ARCH-72 gives each per-lane marker one
// write primitive: `$REG/<lane>-authdead` (C5b: `_authdead_mark`, `_authdead_clear`, `_authdead_sweep_staged`) and
// `$REG/<lane>-disabled` (C5c: `_acct_switch_write`). This file pins every writer of both AS IT IS on the old code,
// before any move, so each later PR proves it moved bytes and nothing else:
//
//   - the auth-dead marker's three writers: the probe (`ccd-account-health`'s `_ah_mark`, `_ah_clear` and its top-level
//     staged-temp sweep), the swap tick's rescue (`_auto_swap_check`'s 401 arm) and the spawn's clear
//     (`_authdead_clear_on_spawn`); `_authdead_expired`'s compare-and-remove is already pinned by
//     `ccd-authdead.test.ts`, and this file holds those rows' titles so a rename there cannot drop them silently;
//   - the disabled switch's three writers through every verb that reaches them (`add`, `declare` and `disable` through
//     `_acct_mark_off`; `enable`; `remove`'s artefact loop), with every report byte for byte (the fixture HOME's path
//     written `$HOME`), every refusal sentence, the non-marker objects per verb, and remove's missing postcondition;
//   - "no roster projection", behaviourally: a hand-raised switch survives every verb that does not name its lane.
//     Its static half is in `single-definition/roster-bash.test.ts`.
//
// SAFETY: fixture HOMEs only. The ccd rows run in `makeCcdHarness`; the probe rows in a throwaway HOME as
// `account-health.test.ts` builds one (a stubbed `curl` first on PATH; the endpoint is never reached); the account
// verbs in `laneStateFixture.ts`'s `laneBox`, as `ccrc-account-kill.test.ts` and `ccrc-account-lock.test.ts` drive
// them. Nothing here runs ccd, `ccrc account …` or `ccd-account-health` against the live `$HOME`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  BASH, CANARY, HAVE_FLOCK, REPO, boxEnv, ccrcIn, laneBox, seedRoster, type Result,
} from './laneStateFixture.js';

/** The plan's lane vocabulary: one upstream and two generated Anthropic token lanes. */
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-u', label: 'lane·u', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'amber', telemetry: 'anthropic' },
    { id: 'lane-a', label: 'lane·a', configDirSuffix: '.claude-lane-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-a-oauth.env' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane·b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ],
};

const nowS = (): number => Math.floor(Date.now() / 1000);
const PAST = 1757203200;
const future = (): number => nowS() + 3600;

// ── the auth-dead marker: the swap tick's rescue and the spawn's clear (ccd) ───────────────────────────────────────

describe('auth-dead, the swap tick\'s rescue write (`_auto_swap_check`\'s 401 arm; D-3522, D-3524)', () => {
  let h: CcdHarness;
  let home: string;
  const reg = (): string => path.join(home, '.cc-sessions');
  const marker = (w: string): string => path.join(reg(), `${w}-authdead`);
  const temps = (): string[] => fs.readdirSync(reg()).filter((n) => /-authdead\.tmp\./.test(n));

  beforeEach(() => {
    h = makeCcdHarness('ccrc-markers-rescue-');
    home = h.home;
    seedAccountsSh(home, ROSTER);
    for (const w of ['lane-u', 'lane-a', 'lane-b']) {
      fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
    }
  });
  afterEach(() => { h.cleanup(); });

  // `ccd-authdead.test.ts`'s carried-loop fixture, in this file's lanes: a transcript row naming the 401 this pane's
  // own process wrote, a pane born after the credential, and the dispatch recorded rather than run.
  const ROW = (at: number): string => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'e1', timestamp: new Date(at * 1000).toISOString(),
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Please run /login · API Error: 401 OAuth token has expired.' }] },
    isApiErrorMessage: true, error: 'authentication_failed', apiErrorStatus: 401,
  });
  const STUBS = `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
      case "\${1:-}" in capture-pane) printf '%s\\n' '? for shortcuts' '❯ ' ;; list-panes) echo 4242 ;; display-message) echo "$BORN" ;; esac; return 0; };
    _pane_box_draft() { :; }; _route_degrade_at_move() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  /** A clock that answers \`date +%s\` with a NEW second on every call, counted in a file (each \`$(date …)\` is a
   *  subshell), from \`$CLOCK0\`: the decision's \`$now\` is one of its answers, and any later \`date +%s\` is another.
   *  Every other \`date\` call is the real one. \`_now_s_to\` takes the stub when a \`date\` function is defined. */
  const CLOCK = `
    date() { if [[ "$*" == "+%s" ]]; then local n; n=$(cat "$HOME/clock-n" 2>/dev/null || echo 0)
      echo $((n + 1)) > "$HOME/clock-n"; echo $((CLOCK0 + n * 7)); else command date "$@"; fi; };`;
  const writeLimits = (w: string, five: number, seven: number): void =>
    fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: nowS() }));
  const cred = (rel: string): string => {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'export CLAUDE_CODE_OAUTH_TOKEN=fixture\n');
    return p;
  };
  /** s1 on lane-a, whose own process wrote a 401 after a pane born at `born`. */
  const arrange = (born: number): void => {
    fs.mkdirSync(path.join(home, 'projects', 'project-a'), { recursive: true });
    writeLimits('lane-a', 5, 5);
    writeLimits('lane-b', 10, 10);
    writeLimits('lane-u', 10, 10);
    h.sh(`_reg_set s1 wrapper lane-a; _reg_set s1 home lane-a; _reg_set s1 project project-a
        _reg_set s1 workdir "$HOME/projects/project-a"; _reg_set s1 uuid 11111111-0000-4000-8000-000000000001; _reg_set s1 started 1`);
    const t = h.sh('_transcript_path s1');
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, [JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', message: { role: 'user', content: 'go' } }), ROW(born + 30)].join('\n') + '\n');
  };
  const decide = (born: number, extra = ''): string =>
    h.sh(`${STUBS} ${CLOCK} ${extra} _auto_swap_check s1 2>"$HOME/rescue.err"; true`, { BORN: String(born), CLOCK0: String(nowS() + 120) });
  const moved = (): string[] => h.calls().filter((l) => l.startsWith('dispatch s1 -> '));

  it('writes "<decision epoch> rescue-401": the decision\'s epoch, the same `$now` it stamps `lastswap` with, never a later clock', () => {
    cred('.cc-secrets/lane-a-oauth.env');
    const born = nowS() + 30;
    arrange(born);
    decide(born);
    expect(moved(), 'the rescue dispatched s1 off its dead lane').toHaveLength(1);
    const body = fs.readFileSync(marker('lane-a'), 'utf8');
    expect(body).toMatch(/^\d+ rescue-401$/);
    const lastswap = h.reg('s1', 'lastswap');
    expect(lastswap, 'the decision stamped lastswap').toMatch(/^\d+$/);
    expect(body, 'the decision\'s epoch').toBe(`${lastswap} rescue-401`);
    expect(temps(), 'no staged temp is left').toEqual([]);
  });

  it('stages the marker in a dotted temp beside it and renames it in: `$REG/<lane>-authdead.tmp.XXXXXX`', () => {
    cred('.cc-secrets/lane-a-oauth.env');
    const born = nowS() + 30;
    arrange(born);
    decide(born, 'mv() { [[ "$*" == *-authdead* ]] && printf "%s|%s\\n" "$*" "$(cat "$2" 2>/dev/null)" >> "$HOME/mv-calls"; command mv "$@"; };');
    const calls = fs.readFileSync(path.join(home, 'mv-calls'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    const [argv, staged] = calls[0]!.split('|');
    const tmp = path.join(reg(), 'lane-a-authdead.tmp.');
    expect(argv!.startsWith(`-f ${tmp}`), argv).toBe(true);
    expect(argv!.endsWith(` ${marker('lane-a')}`), argv).toBe(true);
    expect(staged, 'the temp held the whole marker before the rename').toBe(fs.readFileSync(marker('lane-a'), 'utf8'));
  });

  it.each([
    ['a failed stage', 'mktemp() { [[ "$*" == *-authdead* ]] && return 1; command mktemp "$@"; };'],
    ['a failed rename', 'mv() { [[ "$*" == *-authdead* ]] && return 1; command mv "$@"; };'],
  ])('a failed write is silent and leaves no temp: %s', (_what, stub) => {
    cred('.cc-secrets/lane-a-oauth.env');
    const born = nowS() + 30;
    arrange(born);
    decide(born, stub);
    expect(moved(), 'the rescue itself still happened').toHaveLength(1);
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
    expect(temps(), 'no staged temp is left').toEqual([]);
    expect(fs.readFileSync(path.join(home, 'rescue.err'), 'utf8'), 'silent').toBe('');
  });

  it('a standing marker is never overwritten', () => {
    cred('.cc-secrets/lane-a-oauth.env');
    const born = nowS() + 30;
    arrange(born);
    const standing = `${future()} auth-401`;
    fs.writeFileSync(marker('lane-a'), standing);
    decide(born);
    expect(fs.readFileSync(marker('lane-a'), 'utf8')).toBe(standing);
    expect(temps()).toEqual([]);
  });

  it('a credential changed at or after the pane\'s birth writes nothing: that 401 was about older bytes', () => {
    const born = nowS() - 600;
    arrange(born);
    cred('.cc-secrets/lane-a-oauth.env');
    decide(born);
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
    expect(temps()).toEqual([]);
  });
});

describe('auth-dead, the spawn\'s clear (`_authdead_clear_on_spawn`; D-3524)', () => {
  let h: CcdHarness;
  let home: string;
  const marker = (w: string): string => path.join(home, '.cc-sessions', `${w}-authdead`);
  const clear = (w: string): string => h.sh(`_authdead_clear_on_spawn ${w}; echo "rc=$?"`);
  beforeEach(() => { h = makeCcdHarness('ccrc-markers-spawn-'); home = h.home; seedAccountsSh(home, ROSTER); });
  afterEach(() => { h.cleanup(); });
  const cred = (): void => {
    fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cc-secrets', 'lane-a-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture\n');
  };

  it('answer 1, the credential predates the marker: KEPT, byte for byte', () => {
    cred();
    const body = `${future()} rescue-401`;
    fs.writeFileSync(marker('lane-a'), body);
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.readFileSync(marker('lane-a'), 'utf8')).toBe(body);
  });

  it('answer 0, the credential changed after the marker: removed', () => {
    cred();
    fs.writeFileSync(marker('lane-a'), `${PAST} auth-401`);
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
  });

  it('answer 2, a lane ccd cannot name a credential for: removed', () => {
    fs.writeFileSync(marker('lane-a'), `${future()} auth-401`);
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
  });

  it('an absent marker: nothing there after, rc 0, nothing printed', () => {
    cred();
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
  });

  it('a malformed marker (no epoch) answers 2 and is removed', () => {
    cred();
    fs.writeFileSync(marker('lane-a'), 'yesterday auth-401');
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.existsSync(marker('lane-a'))).toBe(false);
  });

  it('a non-regular marker is removed without being read: a symlink (its target untouched) and a FIFO', () => {
    cred();
    const target = path.join(home, 'outside-the-registry');
    fs.writeFileSync(target, `${future()} auth-401`);
    fs.symlinkSync(target, marker('lane-a'));
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).not.toContain('lane-a-authdead');
    expect(fs.readFileSync(target, 'utf8')).toMatch(/ auth-401$/);
    h.sh(`mkfifo "$HOME/.cc-sessions/lane-a-authdead"`);
    expect(clear('lane-a')).toBe('rc=0');
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).not.toContain('lane-a-authdead');
  });
});

describe('auth-dead, the expiry (`_authdead_expired`): pinned by `ccd-authdead.test.ts`, cited here by name', () => {
  const CITED = [
    'a credential changed after the verdict: not dead, the marker is removed, and nothing is printed on either stream',
    'CONTROL: a credential older than the verdict leaves it standing',
    'the SAME second counts as changed — `>=`, so a tie fails toward reviving the account',
    'a fresh verdict renamed in while the old one is judged SURVIVES, and the account reads dead',
    'a FIFO renamed in inside the window is never opened — the re-read answers dead without blocking',
    'a SYMLINK renamed in carrying the judged epoch is not read through, and not removed',
    'CONTROL: the same seam with nothing renamed in still expires the old verdict',
  ];
  it('every cited row still stands in ccd-authdead.test.ts under its title', () => {
    const src = fs.readFileSync(path.join(REPO, 'server', 'test', 'ccd-authdead.test.ts'), 'utf8');
    for (const t of CITED) expect(src, t).toContain(`it('${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
  });
});

// ── the auth-dead marker: the probe's write (`ccd-account-health`) ─────────────────────────────────────────────────

describe('auth-dead, the probe\'s write (`ccd-account-health`: `_ah_mark`, `_ah_clear`, the staged-temp sweep)', () => {
  // `account-health.test.ts`'s carve-out, for its reason: the probe's only runner is a systemd timer and `_inst_bins`
  // does not place it on a Darwin box.
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  const PROBE = path.join(REPO, 'ccd', 'ccd-account-health');
  let home: string;
  const j = (...p: string[]): string => path.join(home, ...p);
  const marker = (): string => j('.cc-sessions', 'lane-a-authdead');
  const temps = (): string[] => fs.readdirSync(j('.cc-sessions')).filter((n) => n.includes('-authdead.tmp.'));
  const realBin = (name: string): string => spawnSync(BASH, ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();

  beforeEach(() => {
    home = mkTmp('ccrc-markers-probe-');
    fs.mkdirSync(j('.cc-sessions'), { recursive: true });
    fs.mkdirSync(j('.ccrc'), { recursive: true });
    fs.mkdirSync(j('.local', 'bin'), { recursive: true });
    fs.symlinkSync(path.dirname(path.dirname(PROBE)), j('ccrc'));
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify(ROSTER, null, 2));
    fs.mkdirSync(j('.cc-secrets'), { recursive: true });
    fs.writeFileSync(j('.cc-secrets', 'lane-a-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-FIXTURE\n', { mode: 0o600 });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  /** `account-health.test.ts`'s `curl`: one status and body for every call, the body then a newline then the status. */
  const plantCurl = (status: string, body = ''): void => {
    fs.writeFileSync(j('.local', 'bin', 'curl'), `#!/bin/bash\ncat > /dev/null\nprintf '%s\\n%s' ${JSON.stringify(body)} ${JSON.stringify(status)}\n`, { mode: 0o755 });
  };
  /** A tool first on PATH that runs `body` when its argv names an auth-dead path, and is the real tool otherwise. */
  const plantOnMarker = (tool: string, body: string): void => {
    fs.writeFileSync(j('.local', 'bin', tool),
      `#!/bin/bash\ncase "$*" in *-authdead*) ${body} ;; esac\nexec ${JSON.stringify(realBin(tool))} "$@"\n`, { mode: 0o755 });
  };
  const run = (): ReturnType<typeof spawnSync> => spawnSync('bash', [PROBE], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${j('.local', 'bin')}:${process.env['PATH'] ?? ''}`,
      CCRC_HEALTH_URL: 'https://fixture.invalid/api/oauth/usage' },
  });
  const said = (r: ReturnType<typeof spawnSync>, line: string): boolean => String(r.stderr).split('\n').includes(`account-health: ${line}`);

  it('a 401 writes "<epoch> auth-401" by rename from a dotted temp in $REG: no partial file is observable', () => {
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    // At the rename: the argv, whether the marker already stood, and the temp's whole bytes.
    plantOnMarker('mv', 'printf "%s|%s|%s\\n" "$*" "$([ -e "$HOME/.cc-sessions/lane-a-authdead" ] && echo stood || echo absent)" "$(cat "$2")" >> "$HOME/mv-calls"');
    const before = nowS();
    const r = run();
    expect(r.status, String(r.stderr)).toBe(0);
    const body = fs.readFileSync(marker(), 'utf8');
    expect(body).toMatch(/^\d+ auth-401$/);
    const at = Number(body.split(' ')[0]);
    expect(at >= before && at <= nowS() + 1, body).toBe(true);
    expect(said(r, 'lane-a: dead (401)')).toBe(true);
    const calls = fs.readFileSync(j('mv-calls'), 'utf8').trim().split('\n');
    expect(calls, 'one rename onto the marker').toHaveLength(1);
    const [argv, stood, staged] = calls[0]!.split('|');
    const m = /^-f (\S+) (\S+)$/.exec(argv!);
    expect(m, argv).not.toBeNull();
    expect(path.dirname(m![1]!), 'the temp is in $REG, so the rename never crosses a filesystem').toBe(j('.cc-sessions'));
    expect(path.basename(m![1]!)).toMatch(/^lane-a-authdead\.tmp\.[A-Za-z0-9]{6}$/);
    expect(m![2]).toBe(marker());
    expect(stood, 'nothing stood at the marker path before the rename').toBe('absent');
    expect(staged, 'the temp already held the whole marker').toBe(body);
    expect(temps()).toEqual([]);
  });

  it('a temp that cannot be made prints "<lane>: cannot stage a marker" and writes nothing', () => {
    plantCurl('401');
    plantOnMarker('mktemp', 'exit 1');
    const r = run();
    expect(r.status, String(r.stderr)).toBe(0);
    expect(said(r, 'lane-a: cannot stage a marker')).toBe(true);
    expect(said(r, 'lane-a: dead (401)')).toBe(false);
    expect(fs.existsSync(marker())).toBe(false);
    expect(temps()).toEqual([]);
  });

  it('a failed write prints "<lane>: cannot write the marker" and leaves no temp', () => {
    plantCurl('401');
    plantOnMarker('mv', 'exit 1');
    const r = run();
    expect(r.status, String(r.stderr)).toBe(0);
    expect(said(r, 'lane-a: cannot write the marker')).toBe(true);
    expect(fs.existsSync(marker())).toBe(false);
    expect(temps()).toEqual([]);
  });

  it('a live 403-scope answer removes the marker', () => {
    fs.writeFileSync(marker(), `${PAST} auth-401`);
    plantCurl('403', '{"type":"error","error":{"type":"oauth_scope_insufficient"}}');
    const r = run();
    expect(said(r, 'lane-a: live (403 scope)')).toBe(true);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it.each([['429', '{"type":"error","error":{"type":"rate_limit_error"}}'], ['403', '{"error":{"type":"permission_error"}}']])(
    'an unmeasured answer (HTTP %s) writes nothing and clears nothing', (status, body) => {
      plantCurl(status, body);
      run();
      expect(fs.existsSync(marker()), 'nothing written').toBe(false);
      fs.writeFileSync(marker(), `${PAST} auth-401`);
      const r = run();
      expect(said(r, `lane-a: unmeasured — HTTP ${status}`)).toBe(true);
      expect(fs.readFileSync(marker(), 'utf8'), 'nothing cleared').toBe(`${PAST} auth-401`);
    });

  it('a crashed pass\'s staged temps are swept at the next start, whatever that pass then measures', () => {
    for (const n of ['lane-a-authdead.tmp.AbC123', 'lane-b-authdead.tmp.XyZ789']) fs.writeFileSync(j('.cc-sessions', n), '1757203200 auth');
    fs.writeFileSync(j('.cc-sessions', 'lane-a-authdead.tmpx'), 'not a staged temp');
    plantCurl('429');
    run();
    expect(temps()).toEqual([]);
    expect(fs.existsSync(j('.cc-sessions', 'lane-a-authdead.tmpx')), 'only `*-authdead.tmp.*` is swept').toBe(true);
    expect(fs.existsSync(marker())).toBe(false);
  });
});

// ── the disabled switch: every writer, through every verb that reaches it (`ccrc account …`) ───────────────────────

describe('disabled, every writer (`_acct_mark_off` via add/declare/disable, `_acct_enable`, `_acct_remove`)', () => {
  beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

  const box = (prefix: string, roster: unknown = ROSTER): string => laneBox(prefix, roster);
  const reg = (home: string, ...p: string[]): string => path.join(home, '.cc-sessions', ...p);
  const sw = (home: string, id = 'lane-a'): string => reg(home, `${id}-disabled`);
  const bin = (home: string, name: string, body: string): void =>
    fs.writeFileSync(path.join(home, '.local', 'bin', name), body, { mode: 0o755 });
  const realBin = (name: string): string => spawnSync(BASH, ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  /** A tool first on PATH that runs `body` when its argv names a `-disabled` path, and is the real tool otherwise. */
  const onSwitch = (home: string, tool: string, body: string): void =>
    bin(home, tool, `#!/bin/sh\ncase "$*" in *-disabled*) ${body} ;; esac\nexec ${JSON.stringify(realBin(tool))} "$@"\n`);
  const run = (home: string, args: string[], stdin = ''): Result => {
    const r = spawnSync(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
      { env: boxEnv(home), encoding: 'utf8', input: stdin });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** The verb's stdout with the fixture HOME written `$HOME`: compared byte for byte. */
  const report = (home: string, r: Result): string => r.stdout.split(home).join('$HOME');
  const refusal = (error: string, detail: string): string => `${JSON.stringify({ ok: false, error, detail })}\n`;
  const isEmptyRegular = (p: string): boolean => { const s = fs.lstatSync(p); return s.isFile() && s.size === 0; };
  /** `ccrc` sourced, then `script`: the way `ccrc-account-lock.test.ts` reaches one helper. */
  const sourced = (home: string, script: string): Result => {
    const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, '_', ccrcIn(home)], { env: boxEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const ADD_C = ['account', 'add', '--id', 'lane-c', '--provider', 'compatible', '--label', 'lane-c·x', '--hue', 'amber',
    '--base-url', 'https://orchard-api/v1', '--credential', '-'];
  const ENTRY_C = { id: 'lane-c', label: 'lane-c·x', configDirSuffix: '.claude-lane-c',
    exec: { kind: 'generated', provider: 'compatible', baseUrl: 'https://orchard-api/v1', secretsFile: '.cc-secrets/lane-c-compatible.env' },
    homeAble: true, hue: 'amber', telemetry: 'anthropic' };
  const ENTRY_D = { id: 'lane-d', label: 'lane·d', hue: 'violet', configDirSuffix: '.lane-d', homeAble: false, telemetry: 'none',
    exec: { kind: 'external', provider: 'openai' } };
  const OPERATOR_STEPS_C = [
    'claude-usage.timer: this box\'s usage sweep enumerates the accounts it knows about, and it is not ccrc\'s timer — add lane-c to it, or its usage will not be counted.',
    'claude-prune-versions: add lane-c\'s config directory to its keep list, or the next prune will delete the Claude Code versions this lane runs on.',
  ];

  it('`add` leaves the new lane switched off: an empty regular marker, and its `added` report byte for byte', () => {
    const home = box('ccrc-markers-add-');
    const r = run(home, ADD_C, `${CANARY}\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(isEmptyRegular(sw(home, 'lane-c'))).toBe(true);
    expect(report(home, r)).toBe(`${JSON.stringify({ ok: true, id: 'lane-c', disabled: true,
      provisioned: ['settings-env', 'session-hooks', 'coordinator-skill', 'worker-skill', 'reviewer-skill', 'graphify-skill', 'history-skill'],
      'operator-steps': OPERATOR_STEPS_C, roster: { version: 1, accounts: [...ROSTER.accounts, ENTRY_C] } })}\n`);
  });

  it('`declare` leaves the declared lane switched off: an empty regular marker, and its `declared` report byte for byte', () => {
    const home = box('ccrc-markers-declare-');
    bin(home, 'lane-d', 'exit 0\n');
    const r = run(home, ['account', 'declare', '--id', 'lane-d', '--provider', 'openai', '--label', 'lane·d', '--hue', 'violet']);
    expect(r.code, r.stderr).toBe(0);
    expect(isEmptyRegular(sw(home, 'lane-d'))).toBe(true);
    expect(report(home, r)).toBe(`${JSON.stringify({ ok: true, id: 'lane-d', kind: 'external', disabled: true,
      roster: { version: 1, accounts: [...ROSTER.accounts, ENTRY_D] } })}\n`);
  });

  it('`disable` writes an empty regular file by stage and rename (a dotted temp in $REG), and its `switched` report', () => {
    const home = box('ccrc-markers-disable-');
    onSwitch(home, 'mv', `for a; do src="$dst"; dst="$a"; done
      printf '%s|%s|%s\\n' "$src -> $dst" "$( { [ -f "$src" ] && [ ! -L "$src" ] && [ ! -s "$src" ]; } && echo empty-regular || echo other)" "$( [ -e "$dst" ] && echo stood || echo absent)" >> "$HOME/mv-calls"`);
    const r = run(home, ['account', 'disable', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe('{"ok":true,"id":"lane-a","disabled":true}\n');
    expect(isEmptyRegular(sw(home))).toBe(true);
    const calls = fs.readFileSync(path.join(home, 'mv-calls'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    const [move, staged, stood] = calls[0]!.split('|');
    expect(move).toMatch(new RegExp(`^${reg(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.lane-a-disabled\\.tmp\\.\\d+ -> ${sw(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    expect(staged, 'the staged temp was an empty regular file').toBe('empty-regular');
    expect(stood).toBe('absent');
    expect(fs.readdirSync(reg(home)).filter((n) => n.includes('-disabled.tmp.'))).toEqual([]);
  });

  it('`disable` replaces a symlink at the marker path with a regular marker, never writing through it', () => {
    const home = box('ccrc-markers-disable-link-');
    const target = path.join(home, 'outside-the-registry');
    fs.writeFileSync(target, 'untouched');
    fs.symlinkSync(target, sw(home));
    const r = run(home, ['account', 'disable', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(isEmptyRegular(sw(home))).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
  });

  it('`disable` refuses a directory at the marker path (`marker-conflict`) and leaves it', () => {
    const home = box('ccrc-markers-disable-dir-');
    fs.mkdirSync(sw(home));
    const r = run(home, ['account', 'disable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('marker-conflict',
      '$HOME/.cc-sessions/lane-a-disabled is a directory, not the regular marker ccd reads. Move that directory aside, then retry. Nothing was written.'));
    expect(fs.lstatSync(sw(home)).isDirectory()).toBe(true);
  });

  it('`disable` refuses the last globally placeable lane (`last-enabled-home`) and writes nothing', () => {
    const home = box('ccrc-markers-disable-last-');
    bin(home, 'lane-a', '#!/bin/sh\n');
    const r = run(home, ['account', 'disable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('last-enabled-home',
      'account lane-a is the only globally placeable lane - every other home-able account is either disabled (its $HOME/.cc-sessions/<id>-disabled marker is present) or has no executable in $HOME/.local/bin, so disabling this one would leave the fleet with no placement destination at all. Nothing was written.'));
    expect(fs.existsSync(sw(home))).toBe(false);
  });

  it('`disable` through a failed rename answers `disable-marker` with the sentence and disable\'s own "what still stands" clause', () => {
    const home = box('ccrc-markers-disable-mvfail-');
    onSwitch(home, 'mv', 'exit 1');
    const r = run(home, ['account', 'disable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('disable-marker',
      'cannot write $HOME/.cc-sessions/lane-a-disabled by replacing it with an empty regular marker, so this lane cannot be left switched off. Fix that path, then: touch $HOME/.cc-sessions/lane-a-disabled. No marker was written, so account lane-a remains switched on. No other file was written.'));
    expect(fs.existsSync(sw(home))).toBe(false);
    expect(fs.readdirSync(reg(home)).filter((n) => n.includes('-disabled.tmp.'))).toEqual([]);
  });

  describe('`_acct_mark_off`\'s four failures: each its own `disable-marker` sentence, then the caller\'s clause', () => {
    const STANDS = 'WHAT-STILL-STANDS.';
    it.each([
      ['the registry cannot be created', 'mkdir() { return 1; };',
        'cannot create $HOME/.cc-sessions, so this lane cannot be left switched off — and a lane nobody has measured must not be pickable. Create that directory, then: touch $HOME/.cc-sessions/lane-a-disabled.'],
      ['the staged empty marker cannot be written', 'command mkdir "$_SVC_REG/.lane-a-disabled.tmp.$$";',
        'cannot write the staged empty marker $HOME/.cc-sessions/.lane-a-disabled.tmp.<pid>, so this lane cannot be left switched off. Fix $HOME/.cc-sessions, then: touch $HOME/.cc-sessions/lane-a-disabled.'],
      ['the rename fails', '_plat_mv_notdir() { return 1; };',
        'cannot write $HOME/.cc-sessions/lane-a-disabled by replacing it with an empty regular marker, so this lane cannot be left switched off. Fix that path, then: touch $HOME/.cc-sessions/lane-a-disabled.'],
      ['the result is not a regular marker', '_plat_mv_notdir() { rm -f -- "$1"; ln -s "$HOME/elsewhere" "$2"; };',
        '$HOME/.cc-sessions/lane-a-disabled is not a regular marker after the write, so this lane cannot be proved switched off. Fix that path, then: touch $HOME/.cc-sessions/lane-a-disabled.'],
    ])('%s', (_what, stub, sentence) => {
      const home = box('ccrc-markers-markoff-');
      const r = sourced(home, `printf %s "$$" > "$HOME/pid"; ${stub} _acct_mark_off lane-a "${STANDS}"`);
      expect(r.code).toBe(1);
      const pid = fs.readFileSync(path.join(home, 'pid'), 'utf8');
      expect(report(home, r)).toBe(refusal('disable-marker', `${sentence.replace('<pid>', pid)} ${STANDS}`));
    });
  });

  it('`enable` removes a regular marker and answers its `switched` report', () => {
    const home = box('ccrc-markers-enable-');
    fs.writeFileSync(sw(home), '');
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe('{"ok":true,"id":"lane-a","disabled":false}\n');
    expect(fs.existsSync(sw(home))).toBe(false);
  });

  it('`enable` removes a symlink at the marker path, and never its target', () => {
    const home = box('ccrc-markers-enable-link-');
    const target = path.join(home, 'outside-the-registry');
    fs.writeFileSync(target, 'untouched');
    fs.symlinkSync(target, sw(home));
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readdirSync(reg(home))).not.toContain('lane-a-disabled');
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
  });

  const ENABLE_CONFLICT = refusal('marker-conflict',
    '$HOME/.cc-sessions/lane-a-disabled exists but is not a marker file, so its presence does not mean account lane-a is switched off. Move that object aside, then retry. Nothing was written.');

  it('`enable` refuses a directory at the marker path (`marker-conflict`) and leaves it', () => {
    const home = box('ccrc-markers-enable-dir-');
    fs.mkdirSync(sw(home));
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(ENABLE_CONFLICT);
    expect(fs.lstatSync(sw(home)).isDirectory()).toBe(true);
  });

  /** A FIFO at the marker path. */
  const fifo = (home: string): void => { spawnSync('mkfifo', [sw(home)]); expect(fs.lstatSync(sw(home)).isFIFO()).toBe(true); };
  /** A socket at the marker path, bound from inside `$REG` (a full fixture path can pass the sun_path limit); false
   *  when this box cannot make one. */
  const socket = (home: string): boolean => {
    const r = spawnSync('python3', ['-c', 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])', 'lane-a-disabled'],
      { cwd: reg(home), encoding: 'utf8' });
    return r.status === 0 && fs.lstatSync(sw(home)).isSocket();
  };

  it('`enable` refuses a FIFO at the marker path (`marker-conflict`) and leaves it', () => {
    const home = box('ccrc-markers-enable-fifo-');
    fifo(home);
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(ENABLE_CONFLICT);
    expect(fs.lstatSync(sw(home)).isFIFO()).toBe(true);
  });

  it('`enable` refuses a socket at the marker path (`marker-conflict`) and leaves it, where the box can make one', (ctx) => {
    const home = box('ccrc-markers-enable-sock-');
    if (!socket(home)) ctx.skip();
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(ENABLE_CONFLICT);
    expect(fs.lstatSync(sw(home)).isSocket()).toBe(true);
  });

  it('`enable` refuses a failed removal (`marker-write`, "could not remove") and the marker stands', () => {
    const home = box('ccrc-markers-enable-rmfail-');
    fs.writeFileSync(sw(home), '');
    onSwitch(home, 'rm', 'exit 1');
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('marker-write',
      'could not remove $HOME/.cc-sessions/lane-a-disabled, so the account\'s switch state was left unchanged. Nothing was written.'));
    expect(isEmptyRegular(sw(home))).toBe(true);
  });

  it('`enable` refuses an incomplete removal (`marker-write`, "remains after removal"): an `rm` that exits 0 and removes nothing', () => {
    const home = box('ccrc-markers-enable-rmnoop-');
    fs.writeFileSync(sw(home), '');
    onSwitch(home, 'rm', 'exit 0');
    const r = run(home, ['account', 'enable', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('marker-write',
      '$HOME/.cc-sessions/lane-a-disabled remains after removal, so the account\'s switch state was left unchanged. Nothing was written.'));
    expect(isEmptyRegular(sw(home))).toBe(true);
  });

  /** `remove`'s `removed` report for lane-a, with `removed` as given. */
  const removedReport = (removed: string[]): string => `${JSON.stringify({ ok: true, id: 'lane-a',
    roster: { version: 1, accounts: ROSTER.accounts.filter((a) => a.id !== 'lane-a') },
    rehomed: [], kept: [], removed, 'operator-steps': [] })}\n`;

  it('`remove` lists the marker in `removed` at its place in the loop: limits file, marker, hookstate, turn marker', () => {
    const home = box('ccrc-markers-remove-');
    const files = [path.join(home, '.cc-limits', 'lane-a.json'), sw(home), reg(home, 'lane-a.hookstate.json'), reg(home, 'lane-a.turn.json')];
    for (const f of files) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); }
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe(removedReport(['$HOME/.cc-limits/lane-a.json', '$HOME/.cc-sessions/lane-a-disabled',
      '$HOME/.cc-sessions/lane-a.hookstate.json', '$HOME/.cc-sessions/lane-a.turn.json']));
    for (const f of files) expect(fs.existsSync(f), f).toBe(false);
  });

  it('`remove` answers `artifact-conflict` for a directory at the marker path, and keeps it', () => {
    const home = box('ccrc-markers-remove-dir-');
    fs.mkdirSync(sw(home));
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('artifact-conflict',
      '$HOME/.cc-sessions/lane-a-disabled is a directory, not the ccrc-managed file its name denotes, so it was kept. The roster and projection no longer name lane-a; other removal effects remain. Move that directory aside or remove it by hand.'));
    expect(fs.lstatSync(sw(home)).isDirectory()).toBe(true);
  });

  it('`remove` answers `artifact-remove` when the marker cannot be removed', () => {
    const home = box('ccrc-markers-remove-rmfail-');
    fs.writeFileSync(sw(home), '');
    onSwitch(home, 'rm', 'exit 1');
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code).toBe(1);
    expect(report(home, r)).toBe(refusal('artifact-remove',
      'could not remove $HOME/.cc-sessions/lane-a-disabled. The roster and projection no longer name lane-a; other removal effects remain.'));
  });

  it('remove removes a FIFO at the marker path and lists it in `removed` (today\'s `! -d || -L` test admits it)', () => {
    const home = box('ccrc-markers-remove-fifo-');
    fifo(home);
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe(removedReport(['$HOME/.cc-sessions/lane-a-disabled']));
    expect(fs.readdirSync(reg(home))).not.toContain('lane-a-disabled');
  });

  it('remove removes a socket at the marker path and lists it in `removed`, where the box can make one', (ctx) => {
    const home = box('ccrc-markers-remove-sock-');
    if (!socket(home)) ctx.skip();
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe(removedReport(['$HOME/.cc-sessions/lane-a-disabled']));
    expect(fs.readdirSync(reg(home))).not.toContain('lane-a-disabled');
  });

  it('remove has no postcondition: an `rm` that exits 0 and removes nothing still lists the marker and reports success', () => {
    const home = box('ccrc-markers-remove-rmnoop-');
    fs.writeFileSync(sw(home), '');
    onSwitch(home, 'rm', 'exit 0');
    const r = run(home, ['account', 'remove', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(report(home, r)).toBe(removedReport(['$HOME/.cc-sessions/lane-a-disabled']));
    expect(isEmptyRegular(sw(home)), 'the marker is still there').toBe(true);
  });

  it('every marker verb takes the lane lock (`flock -n`), then the marker lock (`flock`), in that order', () => {
    const home = box('ccrc-markers-locks-');
    bin(home, 'flock', `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/flock-calls"\nexec ${JSON.stringify(realBin('flock'))} "$@"\n`);
    bin(home, 'lane-d', 'exit 0\n');
    const calls = (): string[] => {
      const p = path.join(home, 'flock-calls');
      const out = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : [];
      fs.writeFileSync(p, '');
      return out;
    };
    for (const [verb, args, stdin] of [
      ['add', ADD_C, `${CANARY}\n`],
      ['declare', ['account', 'declare', '--id', 'lane-d', '--provider', 'openai', '--label', 'lane·d', '--hue', 'violet'], ''],
      ['disable', ['account', 'disable', '--id', 'lane-a'], ''],
      ['enable', ['account', 'enable', '--id', 'lane-a'], ''],
      ['remove', ['account', 'remove', '--id', 'lane-c'], ''],
    ] as const) {
      const r = run(home, [...args], stdin);
      expect(r.code, `${verb}: ${r.stdout}${r.stderr}`).toBe(0);
      const c = calls();
      expect(c, `${verb}: ${c.join(' | ')}`).toHaveLength(2);
      expect(c[0], `${verb}: the lane lock first`).toMatch(/^-n \d+$/);
      expect(c[1], `${verb}: the marker lock second`).toMatch(/^\d+$/);
    }
  });
});

// ── no roster projection, behaviourally (spec K16; the static half is in single-definition/roster-bash.test.ts) ───

describe('the disabled switch is never projected from the roster (D-7048)', () => {
  beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

  /** The roster with a non-home-able lane: its kind field must never become a switch. */
  const ROSTER_P = { version: 1, accounts: [...ROSTER.accounts,
    { id: 'lane-c', label: 'lane·c', configDirSuffix: '.claude-lane-c',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-c-oauth.env' },
      homeAble: false, hue: 'magenta', telemetry: 'anthropic' }] };

  it('a hand-raised lane-a switch survives byte-identical, mtime and all, every verb that does not name lane-a; homeAble:false writes none', () => {
    const home = laneBox('ccrc-markers-projection-', ROSTER_P);
    const marker = path.join(home, '.cc-sessions', 'lane-a-disabled');
    spawnSync('touch', [marker]);
    const t = new Date(PAST * 1000);
    fs.utimesSync(marker, t, t);
    const stat = (): string => { const s = fs.lstatSync(marker); return `${s.isFile()} ${s.size} ${s.mtimeMs} ${s.ino}`; };
    const before = stat();
    const run = (args: string[], stdin = ''): Result => {
      const r = spawnSync(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args], { env: boxEnv(home), encoding: 'utf8', input: stdin });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    // `ccrc account set` is not a verb on this tree: it refuses, and the switch stands.
    const set = run(['account', 'set', '--id', 'lane-b']);
    expect(set.code).toBe(2);
    expect(JSON.parse(set.stdout)).toMatchObject({ ok: false, error: 'unknown-subcommand' });
    expect(run(['account', 'check', '--id', 'lane-b']).code).toBe(0);
    expect(run(['account', 'disable', '--id', 'lane-b']).code).toBe(0);
    expect(run(['account', 'enable', '--id', 'lane-b']).code).toBe(0);
    // `add` regenerates `accounts.sh` and converges the wrappers (`install: accounts.sh: generated …`).
    const add = run(['account', 'add', '--id', 'lane-d', '--provider', 'compatible', '--label', 'lane-d·x', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1', '--credential', '-'], `${CANARY}\n`);
    expect(add.code, add.stderr).toBe(0);
    expect(add.stderr).toContain('install: accounts.sh: generated');
    // And the generator itself, run over the roster as `ccrc install` runs it.
    seedRoster(home, JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')));
    expect(stat(), 'the hand-raised switch is byte-identical, with its mtime').toBe(before);
    expect(fs.readFileSync(marker, 'utf8')).toBe('');
    expect(fs.readdirSync(path.join(home, '.cc-sessions')).filter((n) => /^lane-[a-z]+-disabled$/.test(n)).sort(),
      'homeAble:false wrote no switch; add wrote its own new lane\'s').toEqual(['lane-a-disabled', 'lane-d-disabled']);
  });
});

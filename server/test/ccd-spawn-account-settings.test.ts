// server/test/ccd-spawn-account-settings.test.ts
//
// D-6202 (accounts plan Task A9, spec §3.1): EVERY fleet session's spawn passes the managed account deny file,
// `~/.cc-sessions/account-deny.settings.json`, in its ONE `--settings` (D-5391). A top-level row with none gets the
// file's path; a routed row (the workflow keys' `--settings '<json>'`) and a `.child` row get one inline value whose
// `permissions.deny` is the UNION of every side's (jq's plain `*` would replace one array with the other). A child's
// `.deny-settings` stays the child file's digest. And the composer FAILS OPEN for the spawn: it is on every swap's path
// (the restart at the end of `cmd_swap`), so a broken account file never refuses or delays a spawn (the operator's Q8
// ruling of 2026-10-19). The harness and the RESUME_DIES substrate are `ccd-spawn-child-settings.test.ts`'s, so both
// spawn lines (the `--resume` primary and the `--session-id` retry) are measured.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness, toolAdjToken as adj } from './ccdWsHelpers.js';
import { paneFragment } from './worktreeIdentityFixture.js';   // path-identity W3 (R8): the pane's entry-identity writer, read from ccd's composer
import { ACCOUNT_DENY_RULES, CHILD_DENY_RULES } from '../../shared/api.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-acct-deny-'); });
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
const CHILD = 'project-a-quiet-basin';
const TOP = 'project-a-calm-mesa';
const acctFile = (): string => path.join(h.home, '.cc-sessions', 'account-deny.settings.json');
const childFile = (): string => path.join(h.home, '.cc-sessions', 'child-deny.settings.json');
const sha = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const install = (): void => {
  execFileSync('bash', [INSTALLER, '--homes'], { env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
};
const seed = (id: string, child: boolean, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}${child ? `\n        _reg_set ${id} child 17` : ''}`);
};
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
/** Both spawn lines of `_spawn_start <id> resume`, and what it said on stderr. `pre` runs first (a fault). */
const spawnBoth = (id: string, pre = ''): { lines: string[]; err: string; code: number } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  // The ccd path and the snippet ride the environment, as the harness's own `sh` does (D-5259).
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${id} resume` },
      { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session')).map(composed);
  return { lines, err: r.stderr ?? '', code: r.status ?? -1 };
};
/** Today's argv for a top-level row (`ccd-spawn-child-settings.test.ts`'s `today`), with `flags` where `launchflags` go. */
const line = (wrapper: string, flags: string, sidflag: string, env = ''): string =>
  `cd '${h.home}' && ${paneFragment(h, TOP, h.home)}true; cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')}${adj(h)}${env} '${h.home}/.local/bin/${wrapper}' ${flags} ${sidflag} --dangerously-skip-permissions`;
const settingsOf = (l: string): string[] => [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
const warnings = (err: string): string[] => err.split('\n').filter((l) => /account deny rules/.test(l));

describe('a top-level row (D-6202)', () => {
  it('a top-level row\'s spawn carries `--settings` with the account file and nothing else changed', () => {
    install(); seed(TOP, false);
    const { lines } = spawnBoth(TOP);
    expect(lines).toEqual([
      line('claude', `--settings '${acctFile()}'`, `--resume '${UUID}'`),
      line('claude', `--settings '${acctFile()}'`, `--session-id '${UUID}'`),
    ]);
    // the rest of today's line, byte for byte: removing the one flag gives the line with no account file at all
    fs.rmSync(acctFile());
    const without = spawnBoth(TOP).lines;
    expect(lines.map((l) => l.replace(`--settings '${acctFile()}'`, ''))).toEqual(without);
    expect(h.reg(TOP, 'deny-settings')).toBeNull();
    expect(h.reg(TOP, 'childshell')).toBeNull();
  });

  it('a routed top-level row (its record holds the workflow keys\' `--settings \'<json>\'`) spawns with exactly one `--settings` that keeps every workflow key and gains every account rule', () => {
    install(); seed(TOP, false);
    h.sh(`_reg_set ${TOP} class opus; _reg_set ${TOP} workflow on`);
    const { lines } = spawnBoth(TOP);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      const s = settingsOf(l);
      expect(s, l).toHaveLength(1);
      const merged = JSON.parse(s[0]!);
      expect(merged.enableWorkflows).toBe(true);
      for (const r of ACCOUNT_DENY_RULES) expect(merged.permissions.deny, r).toContain(r);
      expect(l).toContain('--model opus --settings ');
    }
  });
});

describe('a child row (D-6202 over D-5391)', () => {
  it('a child row\'s spawn carries exactly one `--settings`, the merge of route, child and account, and `.deny-settings` is the child file\'s sha256', () => {
    install(); seed(CHILD, true);
    h.sh(`_reg_set ${CHILD} class opus; _reg_set ${CHILD} workflow on`);
    const { lines } = spawnBoth(CHILD);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      const s = settingsOf(l);
      expect(s, l).toHaveLength(1);
      const merged = JSON.parse(s[0]!);
      expect(merged.enableWorkflows).toBe(true);
      expect(merged.permissions.deny).toEqual(expect.arrayContaining([...CHILD_DENY_RULES, ...ACCOUNT_DENY_RULES]));
      expect(l).toContain('CLAUDE_CODE_SHELL=/bin/bash');
    }
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(childFile()));
  });

  it('a child\'s merged `permissions.deny` contains every `CHILD_DENY_RULES` entry and every `ACCOUNT_DENY_RULES` entry', () => {
    install(); seed(CHILD, true);
    const { lines } = spawnBoth(CHILD);
    for (const l of lines) {
      const s = settingsOf(l);
      expect(s, l).toHaveLength(1);
      const deny: string[] = JSON.parse(s[0]!).permissions.deny;
      for (const r of CHILD_DENY_RULES) expect(deny, r).toContain(r);
      for (const r of ACCOUNT_DENY_RULES) expect(deny, r).toContain(r);
      expect(deny).toHaveLength(new Set([...CHILD_DENY_RULES, ...ACCOUNT_DENY_RULES]).size);
    }
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(childFile()));
  });
});

describe('the composer fails open for the spawn (D-6202; the operator\'s Q8 ruling)', () => {
  it('a missing account file spawns without it and warns, and the child path is unaffected', () => {
    install(); seed(TOP, false); seed(CHILD, true);
    fs.rmSync(acctFile());
    const top = spawnBoth(TOP);
    expect(top.lines).toEqual([line('claude', '', `--resume '${UUID}'`), line('claude', '', `--session-id '${UUID}'`)]);
    expect(warnings(top.err)).toHaveLength(1);
    const child = spawnBoth(CHILD);
    for (const l of child.lines) expect(settingsOf(l)).toEqual([childFile()]);
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(childFile()));
  });

  const FAULTS: ReadonlyArray<[string, () => string]> = [
    ['missing', () => { fs.rmSync(acctFile()); return ''; }],
    ['unreadable', () => { fs.chmodSync(acctFile(), 0o000); return ''; }],
    ['a symlink', () => {
      const real = path.join(h.home, 'elsewhere.json');
      fs.renameSync(acctFile(), real); fs.symlinkSync(real, acctFile()); return '';
    }],
    ['not JSON', () => { fs.writeFileSync(acctFile(), 'not json\n'); return ''; }],
    // the merge is the one jq call that takes `--argjson b`; failing it alone is the fault
    ['the merge fails', () => 'jq() { case " $* " in *" --argjson b "*) return 5 ;; esac; command jq "$@"; };'],
  ];
  it.each(FAULTS)('a swap\'s restart spawns the session on the target lane when the account file is %s: one warning, no refusal, and the child path is unaffected', (name, fault) => {
    install(); seed(TOP, false, 'claude-a'); seed(CHILD, true, 'claude-a');
    // the merge only runs on a row that already holds a `--settings`: route the top-level row for that fault
    if (name === 'the merge fails') h.sh(`_reg_set ${TOP} class opus; _reg_set ${TOP} workflow on`);
    const pre = fault();
    try {
      const top = spawnBoth(TOP, pre);
      expect(top.code, top.err).toBe(0);
      expect(top.lines).toHaveLength(2);
      for (const l of top.lines) {
        expect(l).toContain(`'${h.home}/.local/bin/claude-a'`);
        expect(l).not.toContain(acctFile());
        for (const s of settingsOf(l)) expect(s).not.toContain('ccrc account');
      }
      expect(warnings(top.err), top.err).toHaveLength(1);
      const child = spawnBoth(CHILD, pre);
      expect(child.code, child.err).toBe(0);
      expect(child.lines).toHaveLength(2);
      for (const l of child.lines) {
        expect(l).toContain(`'${h.home}/.local/bin/claude-a'`);
        expect(settingsOf(l)).toEqual([childFile()]);                    // the child's own layer, as before
        expect(l).toContain('CLAUDE_CODE_SHELL=/bin/bash');
      }
      expect(warnings(child.err), child.err).toHaveLength(1);
      expect(h.reg(CHILD, 'childshell')).toBe('/bin/bash');
      expect(h.reg(CHILD, 'deny-settings')).toBe(sha(childFile()));
    } finally {
      if (fs.existsSync(acctFile()) && !fs.lstatSync(acctFile()).isSymbolicLink()) fs.chmodSync(acctFile(), 0o644);
    }
  });
});

describe('SETTINGS_UNION_JQ joins both permission arrays (D-6202)', () => {
  it('two sides carrying `permissions.allow` merge to the first-seen union, and `deny` the same, where plain `*` would keep only the right side', () => {
    const out = h.sh(`jq -c -n '[{"a":1,"permissions":{"allow":["r1","r2"],"deny":["d1"]}},{"b":2,"permissions":{"allow":["r2","r3"],"deny":["d2","d1"]}}]' | jq -c "$SETTINGS_UNION_JQ"`);
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2, permissions: { allow: ['r1', 'r2', 'r3'], deny: ['d1', 'd2'] } });
  });
});

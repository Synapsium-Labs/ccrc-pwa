// server/test/ccd-spawn-child-settings.test.ts
//
// Plan Task 15 (spec §6.6, D-5299, D-5391): a dispatched child (a row with `.child`) spawns with the box's one managed
// deny file through `--settings` and with its Bash tool pinned to bash, and the spawn records both
// (`$REG/<id>.deny-settings`, `$REG/<id>.childshell`); a row without `.child` spawns byte-identically to today and
// writes neither. The harness and the RESUME_DIES substrate are `ccd-route-spawn.test.ts`'s, so both spawn lines (the
// `--resume` primary and the `--session-id` retry) are measured.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CHILD_DENY_RULES, CHILD_DENY_PATH_QUALIFIED } from '../../shared/api.js';
import { FORBIDDEN_CCD_VERBS } from '../src/coord/approvalguard.js';
import { childShellOf, denySettingsOf, readSessionRecord } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-child-deny-'); });
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
const denyFile = (): string => path.join(h.home, '.cc-sessions', 'child-deny.settings.json');
const sha = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const install = (): void => {
  execFileSync('bash', [INSTALLER, '--homes'], { env: { ...process.env, HOME: h.home } });
};
const seed = (id: string, child: boolean): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}${child ? `\n        _reg_set ${id} child 17` : ''}`);
};
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
const spawnBoth = (id: string): string[] => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  h.sh(`${RESUME_DIES} _spawn_start ${id} resume 2>/dev/null`);
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
  expect(lines).toHaveLength(2);
  return lines.map(composed);
};
/** Today's argv for a top-level row, spelled from ccd's own `_resume_env` (`ccd-route-spawn.test.ts`'s rule). */
const today = (sidflag: string): string =>
  `cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')} '${h.home}/.local/bin/claude'  ${sidflag} --dangerously-skip-permissions`;
/** A child's argv: today's, plus its temp root and the shell pin in the env, and `--settings` before the id flag. */
const childLine = (id: string, settings: string, sidflag: string): string =>
  `cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')} TMPDIR='${h.home}/.cc-tmp/${id}' `
  + `CLAUDE_CODE_SHELL=/bin/bash '${h.home}/.local/bin/claude' --settings '${settings}' ${sidflag} --dangerously-skip-permissions`;

describe('CHILD_DENY_RULES (spec §6.6)', () => {
  it('is Task 12\'s forbidden ccd verbs, then ccrc update and rollback; the path-qualified forms wait on Task 13', () => {
    expect(CHILD_DENY_PATH_QUALIFIED).toBe(false);
    expect(CHILD_DENY_RULES).toEqual([
      ...FORBIDDEN_CCD_VERBS.map((v) => `Bash(ccd ${v}:*)`), 'Bash(ccrc update:*)', 'Bash(ccrc rollback:*)',
    ]);
  });
});

describe('_spawn_start of a row WITHOUT .child is byte-identical to today (plan Task 15)', () => {
  it('both lines equal today\'s spelling and the spawn with no deny file at all, and no field is written', () => {
    seed(TOP, false);
    const without = spawnBoth(TOP);
    install();
    expect(fs.existsSync(denyFile())).toBe(true);
    const withFile = spawnBoth(TOP);
    expect(withFile).toEqual(without);                                    // byte comparison: the file changes nothing
    expect(withFile[0]).toBe(today(`--resume '${UUID}'`));
    expect(withFile[1]).toBe(today(`--session-id '${UUID}'`));
    for (const l of withFile) { expect(l).not.toContain('--settings'); expect(l).not.toContain('CLAUDE_CODE_SHELL'); }
    expect(h.reg(TOP, 'deny-settings')).toBeNull();
    expect(h.reg(TOP, 'childshell')).toBeNull();
  });
});

describe('_spawn_start of a .child row passes the deny file and the shell pin, and records them (plan Task 15)', () => {
  it('both lines carry --settings <file> and CLAUDE_CODE_SHELL=/bin/bash; .deny-settings is the file\'s sha256', () => {
    install(); seed(CHILD, true);
    const [primary, retry] = spawnBoth(CHILD);
    expect(primary).toBe(childLine(CHILD, denyFile(), `--resume '${UUID}'`));
    expect(retry).toBe(childLine(CHILD, denyFile(), `--session-id '${UUID}'`));
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(denyFile()));
    expect(h.reg(CHILD, 'childshell')).toBe('/bin/bash');
  });

  it('a resume after the file changed rewrites .deny-settings to the new digest', () => {
    install(); seed(CHILD, true);
    spawnBoth(CHILD);
    const first = h.reg(CHILD, 'deny-settings');
    const doc = JSON.parse(fs.readFileSync(denyFile(), 'utf8'));
    doc.permissions.deny.push('Bash(ccd ws-extra:*)');
    fs.writeFileSync(denyFile(), JSON.stringify(doc));
    spawnBoth(CHILD);
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(denyFile()));
    expect(h.reg(CHILD, 'deny-settings')).not.toBe(first);
  });

  it('a spawn with the file missing passes no --settings and writes no .deny-settings (a stale one is removed)', () => {
    install(); seed(CHILD, true);
    spawnBoth(CHILD);
    expect(h.reg(CHILD, 'deny-settings')).not.toBeNull();
    fs.rmSync(denyFile());
    const lines = spawnBoth(CHILD);
    for (const l of lines) expect(l).not.toContain('--settings');
    expect(h.reg(CHILD, 'deny-settings')).toBeNull();
    expect(h.reg(CHILD, 'childshell')).toBe('/bin/bash');                // the pin does not depend on the file
  });

  it('a file that is not a deny file is not passed and not recorded', () => {
    install(); seed(CHILD, true);
    fs.writeFileSync(denyFile(), '{"permissions":{"deny":[]}}\n');
    for (const l of spawnBoth(CHILD)) expect(l).not.toContain('--settings');
    expect(h.reg(CHILD, 'deny-settings')).toBeNull();
  });

  it('a child whose route composed --settings gets ONE --settings: the route JSON merged with the deny file (D-5391)', () => {
    install(); seed(CHILD, true);
    h.sh(`_reg_set ${CHILD} class opus; _reg_set ${CHILD} workflow on`);
    const lines = spawnBoth(CHILD);
    for (const l of lines) {
      expect(l.match(/--settings /g)).toHaveLength(1);
      const m = /--model opus --settings '([^']*)' --resume|--model opus --settings '([^']*)' --session-id/.exec(l);
      expect(m, l).not.toBeNull();
      const merged = JSON.parse(m![1] ?? m![2]!);
      expect(merged.enableWorkflows).toBe(true);
      expect(merged.permissions.deny).toEqual([...CHILD_DENY_RULES]);
    }
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(denyFile()));
  });
});

describe('the registry reads the spawn record three ways (plan Task 15)', () => {
  const D = 'a'.repeat(64);
  it('.deny-settings: unlisted is none, a sha256 is a digest, anything else listed is unreadable', () => {
    expect(denySettingsOf(null)).toEqual({ kind: 'none' });
    expect(denySettingsOf({ ok: true, content: D })).toEqual({ kind: 'digest', sha256: D });
    expect(denySettingsOf({ ok: true, content: `${D}x` })).toEqual({ kind: 'unreadable' });
    expect(denySettingsOf({ ok: true, content: '' })).toEqual({ kind: 'unreadable' });
    expect(denySettingsOf({ ok: false, reason: 'unreadable' })).toEqual({ kind: 'unreadable' });
  });
  it('.childshell: unlisted is none, an absolute path is pinned, anything else listed is unreadable', () => {
    expect(childShellOf(null)).toEqual({ kind: 'none' });
    expect(childShellOf({ ok: true, content: '/bin/bash' })).toEqual({ kind: 'pinned', shell: '/bin/bash' });
    expect(childShellOf({ ok: true, content: 'bash' })).toEqual({ kind: 'unreadable' });
    expect(childShellOf({ ok: false, reason: 'absent' })).toEqual({ kind: 'unreadable' });
  });
});

describe('the registry listing carries the spawn record (plan Task 15, for Task 16\'s 409 deny-not-engaged)', () => {
  it('a record with neither field keeps today\'s shape; a listed field reads through the one reader', async () => {
    const home = mkTmp('ccrc-child-deny-reg-');
    try {
      seedRoster(home);
      const reg = path.join(home, '.cc-sessions');
      fs.mkdirSync(reg, { recursive: true });
      const id = CHILD;
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1', child: '17' })) {
        fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
      }
      const read = async () => {
        const r = await readSessionRecord(localIO, loadConfig({ CCRC_HOME: home }), id);
        if (!r.found) throw new Error(r.reason);
        return r.record;
      };
      const bare = await read();
      expect('denySettings' in bare).toBe(false);
      expect('childShell' in bare).toBe(false);
      const D = 'b'.repeat(64);
      fs.writeFileSync(path.join(reg, `${id}.deny-settings`), D);
      fs.writeFileSync(path.join(reg, `${id}.childshell`), '/bin/bash');
      const full = await read();
      expect(full.denySettings).toEqual({ kind: 'digest', sha256: D });
      expect(full.childShell).toEqual({ kind: 'pinned', shell: '/bin/bash' });
      fs.writeFileSync(path.join(reg, `${id}.deny-settings`), 'not-a-digest');
      expect((await read()).denySettings).toEqual({ kind: 'unreadable' });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

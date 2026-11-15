// The Overlord W1 pool set, PR A3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Tasks 4 and 5):
// every ccd user of the pool decision keyed by a session reads its side through `_session_pool_side`, so a session whose
// route record carries a set is placed, swapped, preferred, started, re-seeded, relocated and stranded by that set, never
// by its project's tag (Table 3.4d). The crossing marker carries its kind (`set:<spelling>`), and an undecided pool answer
// names its side: `pool` (the project's tag), `projection` (`$REG/pool-epoch`) or `set` (`$REG/<id>.poolset`).
//
// The session is `claude-overlord`, in the untagged project `overlord` (which every account would serve), with the set
// `pool-b`. Accounts: claude and claude-a in pool-a, claude-b in pool-b, claude-d in no pool. A NEW row with a set is a
// case production never meets (a new id carries no set), so its fixture plants the set by hand (review 2092 N13).
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, systemd and the dispatcher are stubs. No real pool, account or path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import {
  CCD, ghContainedEnv, makeCcdHarness, plantPoolEpoch, seedAccountsSh, WS_ADD, WIDE_PANE, type CcdHarness,
} from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER, POOL_BY_ID } from './fixtures/poolRule.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-pool-a3-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  plantPoolEpoch(h.home, POOL_BY_ID);
});
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-3333-4bcc-b60b-0cfc0dc3d199';
const PROJECT = 'overlord';
const ID = `claude-${PROJECT}`;
const PANE_PID = '4242';
const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const read = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const swapLog = (): string => read(reg('swap.log'));
const calls = (): string => read(path.join(h.home, 'ccd-calls'));
const setOf = (id: string): string => reg(`${id}.poolset`);
const plantSet = (spelling: string, id = ID): void => { fs.writeFileSync(setOf(id), spelling); };
/** A set that exists and cannot be read: a directory at its path, which every uid reads as `set-unreadable`. */
const unreadableSet = (id = ID): void => { fs.rmSync(setOf(id), { force: true }); fs.mkdirSync(setOf(id)); };
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};
const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const seedRow = (wrapper: string, id = ID, home = wrapper): string => {
  const wd = path.join(h.home, 'projects', PROJECT);
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${id} uuid ${UUID}
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} home ${home}
    _reg_set ${id} project ${PROJECT}
    _reg_set ${id} workdir ${wd}
    _reg_set ${id} started 1`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};
const plantTranscript = (mdir: string): void => {
  const dir = path.join(h.home, '.claude-b', 'projects', mdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
};
const run = (snippet: string, env: NodeJS.ProcessEnv = {}): { code: number; stderr: string } => {
  const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 30000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stderr: String(r.stderr ?? '') };
};
const NO_PANE = 'case "${1:-}" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac;';
const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ` tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} ${NO_PANE} return 0; }; sleep() { :; };`;
const START_STUBS = `${WS_ADD} _alive() { return 1; }; _have_systemctl() { return 1; };`;
const pane = (lines: string): string => `
  tmux() { ${WIDE_PANE} case "\${1:-}" in
             capture-pane) printf '%s\\n' ${lines} ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const AFFINITY = pane('"────────────────────────" "❯ " "────────────────────────"');
const BLOCKED = pane('"API Error: 429 Too Many Requests"');
const idleStatus = (cfg = '.claude'): void => {
  const dir = path.join(h.home, cfg, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`), JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};
const tick = (stubs: string): string => h.sh(`${stubs} _auto_swap_check ${ID}`);
const target = (cur: string, home = cur, force = ''): string =>
  h.sh(`out=$(_swap_target ${ID} ${cur} ${home} ${force}); printf '%s|rc=%s' "$out" "$?"`);
const SET_PATH = (id = ID): string => `${reg(`${id}.poolset`)}`;

describe('Task 4: the swap target honours the set', () => {
  it('a row on a pool-a account outside its set must leave, and goes to the set\'s account', () => {
    seedRow('claude'); plantSet('pool-b');
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    expect(target('claude')).toBe('claude-b|rc=0');
  });

  it('never names an account outside the set, even with room, and the untagged one only when the set admits it', () => {
    seedRow('claude-b'); plantSet('pool-b');
    writeLimits('claude-b', 99, 99);
    for (const w of ['claude', 'claude-a', 'claude-d']) writeLimits(w, 5, 5);
    expect(target('claude-b', 'claude-b', '1')).toBe('|rc=1');
    plantSet('pool-b+untagged');
    expect(target('claude-b', 'claude-b', '1')).toBe('claude-d|rc=0');
  });

  it('the project\'s tag binds nothing once a set stands: a pool-a project, a pool-b set', () => {
    fs.mkdirSync(reg('pools'), { recursive: true }); fs.writeFileSync(path.join(reg('pools'), PROJECT), 'pool-a\n');
    seedRow('claude'); plantSet('pool-b');
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    expect(target('claude')).toBe('claude-b|rc=0');
  });
});

describe('Task 4: ccd swap and ccd prefer honour the set, and --cross-pool crosses it', () => {
  it('ccd swap to an account outside the set refuses a mismatch that names the set', () => {
    const mdir = seedRow('claude-b'); plantTranscript(mdir); plantSet('pool-b');
    const r = run(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("pool-mismatch: claude-a is in pool 'pool-a'");
    expect(r.stderr).toContain("not in the session's pool set 'pool-b'");
    expect(r.stderr).toContain(`ccd swap --cross-pool ${ID} claude-a`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
  });

  it('--cross-pool writes a set: marker and logs pool=set:pool-b', () => {
    const mdir = seedRow('claude-b'); plantTranscript(mdir); plantSet('pool-b');
    const r = run(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-a`, { TMUX: '' });
    expect(r.code, r.stderr).toBe(0);
    expect(h.reg(ID, 'wrapper')).toBe('claude-a');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} set:pool-b claude-a$/);
    expect(swapLog()).toContain(`cross-pool ${ID}: claude-b -> claude-a [project=${PROJECT} pool=set:pool-b target-pool=pool-a]`);
  });

  it('ccd prefer refuses, and --cross-pool marks', () => {
    seedRow('claude-b'); plantSet('pool-b');
    const r = run(`${SWAP_STUBS} cmd_prefer ${ID} claude-a`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("not in the session's pool set 'pool-b'");
    expect(r.stderr).toContain(`ccd prefer --cross-pool ${ID} claude-a`);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    expect(run(`${SWAP_STUBS} cmd_prefer --cross-pool ${ID} claude-a`, { TMUX: '' }).code).toBe(0);
    expect(h.reg(ID, 'home')).toBe('claude-a');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} set:pool-b claude-a$/);
  });

  it('ccd swap and ccd prefer bind no id _reg_id_ok refuses, even one whose path reaches a .uuid (A2 review F5)', () => {
    // `$REG/../stray.uuid` exists, so the old `-f` test alone would have taken `../stray` as a session.
    fs.writeFileSync(path.join(h.home, 'stray.uuid'), `${UUID}\n`);
    plantSet('pool-b', '../stray');
    for (const verb of ['swap', 'prefer']) {
      const r = run(`${SWAP_STUBS} cmd_${verb} ../stray claude-a`, { TMUX: '' });
      expect(r.code, verb).not.toBe(0);
      expect(r.stderr, verb).toContain("no registry for '../stray'");
    }
  });
});

describe('Task 4: cmd_start — a new row outside the set is refused; an existing one warns, and the tick relocates it', () => {
  const NEW = `claude-a-${PROJECT}`;
  it('a NEW row on an account outside its (hand-planted) set is refused, and nothing is created', () => {
    fs.mkdirSync(path.join(h.home, 'projects', PROJECT), { recursive: true });
    plantSet('pool-b', NEW);
    const r = run(`${START_STUBS} cmd_start claude-a ${PROJECT}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("pool-mismatch: claude-a is in pool 'pool-a'");
    expect(r.stderr).toContain("not in the session's pool set 'pool-b'");
    expect(fs.existsSync(reg(`${NEW}.uuid`))).toBe(false);
  });

  it('a NEW row whose set cannot be read is refused, naming the set file', () => {
    fs.mkdirSync(path.join(h.home, 'projects', PROJECT), { recursive: true });
    unreadableSet(NEW);
    const r = run(`${START_STUBS} cmd_start claude-a ${PROJECT}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`the pool set for session ${NEW} is unreadable: ${SET_PATH(NEW)}`);
    expect(fs.existsSync(reg(`${NEW}.uuid`))).toBe(false);
  });

  it('an EXISTING row revived on an account outside its set warns with the set-side text, and starts', () => {
    seedRow('claude-a', NEW); plantSet('pool-b', NEW);
    const r = run(`${START_STUBS} cmd_start claude-a ${PROJECT}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain(`ccd: warn: ${NEW} lives on claude-a: claude-a is in pool 'pool-a'`);
    expect(r.stderr).toContain("not in the session's pool set 'pool-b' — the auto-swapper relocates it at the next idle boundary");
    expect(h.reg(NEW, 'wrapper')).toBe('claude-a');
  });

  it('an EXISTING row whose set cannot be read warns naming the set file, where a project-side rc 2 is silent', () => {
    seedRow('claude-a', NEW); unreadableSet(NEW);
    const r = run(`${START_STUBS} cmd_start claude-a ${PROJECT}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain(`ccd: warn: ${NEW} lives on claude-a and its pool could not be decided: the pool set for session ${NEW} is unreadable: ${SET_PATH(NEW)}`);
  });

  it('a NEW row started --cross-pool outside its (hand-planted) set writes the set: marker (review 2154 F6a)', () => {
    fs.mkdirSync(path.join(h.home, 'projects', PROJECT), { recursive: true });
    plantSet('pool-b', NEW);
    const r = run(`${START_STUBS} cmd_start --cross-pool claude-a ${PROJECT}`);
    expect(r.code, r.stderr).toBe(0);
    expect(h.reg(NEW, 'crosspool')).toMatch(/^\d{10} set:pool-b claude-a$/);
  });

  it('an EXISTING row whose set reads but whose projection is stale warns, naming the projection (review 2154 F6b)', () => {
    seedRow('claude-b', `claude-b-${PROJECT}`); plantSet('pool-b', `claude-b-${PROJECT}`);
    plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 });
    const r = run(`${START_STUBS} cmd_start claude-b ${PROJECT}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr.trim()).toBe(`ccd: warn: claude-b-${PROJECT} lives on claude-b and its pool could not be decided: the pool projection`
      + ` for claude-b is stale: ${reg('pool-epoch')} is past its lease — the remedy is the control-plane link (the pool sync),`
      + ' not this file; the session pool set decided; the project tag is not involved — nothing moves until it can');
  });

  it('an EXISTING row in its set says nothing', () => {
    seedRow('claude-b', `claude-b-${PROJECT}`); plantSet('pool-b', `claude-b-${PROJECT}`);
    const r = run(`${START_STUBS} cmd_start claude-b ${PROJECT}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('warn');
  });
});

describe('Task 4: the tick — relocation into the set, and the home re-seed stands down', () => {
  it('relocates an existing row on an account outside its set at the idle boundary, and writes no home', () => {
    seedRow('claude'); plantSet('pool-b'); idleStatus();
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    writeLimits('claude', 60, 60);   // the busiest: a re-seed by the project (untagged) would move home off it
    tick(AFFINITY);
    expect(calls()).toContain(`dispatch ${ID} -> claude-b`);
    expect(swapLog()).toContain(`auto-pool ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'home'), 'the re-seed stands down for a set side (Table 3.4d)').toBe('claude');
    expect(swapLog()).not.toContain(' rehome ');
  });

  it('the same row with no set is the project\'s: untagged, so nothing moves', () => {
    seedRow('claude'); idleStatus();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(AFFINITY);
    expect(calls()).not.toContain('dispatch');
  });

  it('a rescue may land on a prefer --cross-pool home outside the set (today\'s behaviour, pinned)', () => {
    seedRow('claude-b', ID, 'claude-a'); plantSet('pool-b');
    h.sh(`_reg_set ${ID} crosspool "$(date +%s) set:pool-b claude-a"`);
    writeLimits('claude-b', 99, 99); writeLimits('claude-a', 5, 5); writeLimits('claude', 5, 5); writeLimits('claude-d', 5, 5);
    tick(BLOCKED);
    expect(calls()).toContain(`dispatch ${ID} -> claude-a`);
  });
});

describe('Task 4: the pay-per-use lane and the strand read the set', () => {
  /** The pay-per-use lane `lane-d`, in `pool`, or in no pool at all when `pool` is undefined. */
  const plantLane = (pool: string | undefined): void => {
    seedAccountsSh(h.home, {
      ...POOLED_TEST_ROSTER,
      accounts: [...POOLED_TEST_ROSTER.accounts, {
        id: 'lane-d', label: 'lane·d', configDirSuffix: '.claude-lane-d',
        exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-d-openrouter.env' },
        homeAble: false, hue: 'amber', telemetry: 'openrouter', ...(pool === undefined ? {} : { pool }),
      }],
    });
    plantPoolEpoch(h.home, { ...POOL_BY_ID, 'lane-d': pool });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'lane-d'), '#!/bin/sh\n', { mode: 0o755 });
  };
  it('a pay-per-use lane in a pool of the set joins the candidates', () => {
    plantLane('pool-b'); seedRow('claude-b'); plantSet('pool-b');
    expect(h.sh(`_default_pool ${ID}`)).toContain('lane-d');
  });
  it('one in a pool outside the set does not', () => {
    plantLane('pool-a'); seedRow('claude-b'); plantSet('pool-b');
    expect(h.sh(`_default_pool ${ID}`)).not.toContain('lane-d');
  });
  it('an untagged lane that a +untagged set serves is still named by no pool, so it stays out (review 2154 F1)', () => {
    // `_pool_ok` answers rc 0 here with the account side `untagged`: only the `named` conjunct keeps the billed lane out.
    plantLane(undefined); seedRow('claude-b'); plantSet('pool-b+untagged');
    expect(h.sh(`_pool_ok lane-d "$(_session_pool_side ${ID})"; echo "rc=$? $POOL_OK_SIDE $POOL_OK_STATE"`)).toBe('rc=0 account untagged');
    expect(h.sh(`_default_pool ${ID}`)).not.toContain('lane-d');
  });
  it('a set that cannot be decided admits no pay-per-use lane, even one in a pool it would name (review 2154 F1)', () => {
    plantLane('pool-b'); seedRow('claude-b');
    for (const [label, plant] of [['unreadable', () => unreadableSet()], ['malformed', () => plantSet('poola,pool-b')]] as const) {
      plant();
      expect(h.sh(`_session_pool_side ${ID}`), label).toBe(`set-${label}`);
      expect(h.sh(`_default_pool ${ID}`), label).not.toContain('lane-d');
      fs.rmSync(setOf(ID), { recursive: true, force: true });
    }
  });

  it('the strand names the set by its token, set:pool-b', () => {
    seedRow('claude-b'); plantSet('pool-b'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_strand_mark ${ID} claude-b ${PROJECT}`);
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} claude:pool=pool-a claude-a:pool=pool-a claude-d:pool=untagged$/);
    expect(swapLog()).toContain(`stranded ${ID}: claude-b (blocked) -> nowhere [pool=set:pool-b]`);
    expect(read(path.join(h.home, 'notify-log'))).toContain('no account in pool set:pool-b can take it');
  });
});

describe('Task 4 and 5: a set that cannot be read decides nothing, on the set side, and names its file', () => {
  it('the swap target answers rc 8 (the set side)', () => {
    seedRow('claude'); unreadableSet();
    expect(target('claude')).toBe('|rc=8');
  });
  it('ccd swap and ccd prefer refuse, naming the set file, even with --cross-pool', () => {
    const mdir = seedRow('claude-b'); plantTranscript(mdir); unreadableSet();
    for (const verb of ['swap', 'swap --cross-pool', 'prefer', 'prefer --cross-pool']) {
      const r = run(`${SWAP_STUBS} cmd_${verb.split(' ')[0]} ${verb.split(' ')[1] ?? ''} ${ID} claude-a`, { TMUX: '' });
      expect(r.code, verb).not.toBe(0);
      expect(r.stderr, verb).toContain(`the pool set for session ${ID} is unreadable: ${SET_PATH()}`);
      expect(r.stderr, verb).toContain('nothing was touched');
    }
  });
  it('the strand line is set:unreadable and names the set file', () => {
    seedRow('claude'); unreadableSet();
    expect(h.sh(`_strand_why ${ID} ${PROJECT}`)).toBe(`set:unreadable ${SET_PATH()}`);
  });
  it('the tick stamps set and strands with the set sentence, for an unreadable and a malformed set alike', () => {
    seedRow('claude'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    for (const [label, plant] of [['unreadable', () => unreadableSet()], ['malformed', () => plantSet('poola,pool-b')]] as const) {
      for (const f of ['tickstuck', 'stranded', 'strandnotify']) fs.rmSync(reg(`${ID}.${f}`), { force: true });
      plant();
      tick(BLOCKED);
      expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], label).toBe('set');
      expect(String(h.reg(ID, 'stranded')), label)
        .toContain(`the account set on the route record could not be read or parsed (${SET_PATH()})`);
      fs.rmSync(setOf(ID), { recursive: true, force: true });
    }
  });
  it('_strand_mark with no cause names an undecidable set by its word, never as untagged (review 2154 F6c)', () => {
    seedRow('claude'); unreadableSet(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_strand_mark ${ID} claude ${PROJECT}`);
    expect(swapLog()).toContain(`stranded ${ID}: claude (blocked) -> nowhere [pool=set-unreadable]`);
    expect(swapLog()).not.toContain('[pool=-]');
  });
  it('the rescue map names the set side from rc 8, and the projection from rc 7', () => {
    seedRow('claude'); plantNotify();
    for (const [rc, word, says] of [['8', 'set', 'account set on the route record'], ['7', 'projection', 'pool projection could not be read']] as const) {
      fs.rmSync(reg(`${ID}.tickstuck`), { force: true }); fs.rmSync(reg(`${ID}.stranded`), { force: true });
      h.sh(`${BLOCKED} _swap_target() { return ${rc}; }; _auto_swap_check ${ID}`);
      expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], rc).toBe(word);
      expect(String(h.reg(ID, 'stranded')), rc).toContain(says);
    }
  });
});

describe('Task 5: the crossing marker carries its kind', () => {
  const crossed = (field: string, acct: string): void => {
    h.sh(`_reg_set ${ID} crosspool "$(date +%s) ${field} ${acct}"; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
  };
  it('stays valid while the set reads the same spelling, lapses when it grows, and does not come back', () => {
    seedRow('claude-a', ID, 'claude-b'); plantSet('pool-b'); crossed('set:pool-b', 'claude-a');
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    expect(h.sh(`_crosspool_valid ${ID} "set pool-b" claude-a; echo "rc=$?"`)).toBe('rc=0');
    expect(h.sh(`_crosspool_valid ${ID} "named pool-b" claude-a; echo "rc=$?"`), 'a named side never matches a set: field').toBe('rc=1');
    tick(AFFINITY);
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} set:pool-b claude-a$/);
    plantSet('pool-a,pool-b');
    tick(AFFINITY);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: account set is now pool-a,pool-b`);
    plantSet('pool-b');
    tick(AFFINITY);
    expect(h.reg(ID, 'crosspool')).toBeNull();
  });
  it('a set saved again with the same members (its spelling is sorted) keeps the crossing', () => {
    seedRow('claude', ID, 'claude-d'); plantSet('pool-a,pool-b'); crossed('set:pool-a,pool-b', 'claude-d');
    expect(h.sh(`_crosspool_valid ${ID} "set pool-a,pool-b" claude-d; echo "rc=$?"`)).toBe('rc=0');
  });
  it('with the set unreadable, a valid-looking marker is kept: undecided never deletes it', () => {
    seedRow('claude-a', ID, 'claude-b'); crossed('set:pool-b', 'claude-a'); unreadableSet();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    tick(AFFINITY);
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} set:pool-b claude-a$/);
    expect(swapLog()).not.toContain('crosspool-ended');
  });
});

describe('Task 5: the undecided words by side', () => {
  it('a tagged project with a stale projection strands with the projection sentence on the tick', () => {
    fs.mkdirSync(reg('pools'), { recursive: true }); fs.writeFileSync(path.join(reg('pools'), PROJECT), 'pool-a\n');
    seedRow('claude'); plantNotify(); plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 });
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    tick(BLOCKED);
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1]).toBe('projection');
    const said = String(h.reg(ID, 'stranded'));
    expect(said).toContain(`the pool projection could not be read (${reg('pool-epoch')})`);
    expect(said).toContain('the remedy is the pool sync and the control-plane link, not the project tag');
    expect(target('claude')).toBe('|rc=7');
  });
  it('a set session with a stale projection says the set decided, not the project tag', () => {
    seedRow('claude'); plantSet('pool-a'); plantNotify(); plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 });
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    tick(BLOCKED);
    expect(String(h.reg(ID, 'stranded'))).toContain('the session pool set decided, and the project tag is not involved');
    const r = run(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(r.stderr, 'the start, swap and prefer paths say it too (A2 review F1)').toContain('the session pool set decided');
  });
  it('_rescue_target treats rc 7 and 8 as undecided, with a non-empty answer, and reads no swap log', () => {
    seedRow('claude');
    for (const rc of [7, 8]) {
      const out = h.sh(`_swap_target() { echo claude-b; return ${rc}; }; _rescue_history() { echo history-read >> "$HOME/ccd-calls"; return 0; };
        out=$(_rescue_target ${ID} claude claude 1 0); echo "[$out] rc=$?"`);
      expect(out).toBe(`[claude-b] rc=${rc}`);
    }
    expect(calls()).not.toContain('history-read');
  });
});

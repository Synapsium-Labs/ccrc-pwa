// The Overlord W1 pool set, PR A3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Task 4 Step 1,
// review 2085 F14): CHARACTERIZATION, written and green on `main` before any reader moved. Each user of the pool decision
// keyed by a session (Table 3.4d) is driven for a session WITHOUT a set, in each project state and in each undecidable
// account state of a tagged project, and its answer, sentence or log line is pinned here verbatim (the fixture HOME
// written as `$HOME`, the clock as `<ts>`). Task 4 moves every one of these users onto `_session_pool_side`; Review
// Focus 2 says nothing here may change. The one named change is Task 5's `projection` word (slug
// `projection-word-fleet-wide`): it rewrote nine rows, the swap target's rc (4 to 7), the re-seed's stamp and the
// strand tick's sentence, stamp and log line in the three account states, in the commit that made it and in no other.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, systemd and the dispatcher are stubs. Pool names are the fixture table's
// (`pool-a`, `pool-b`), account ids the test roster's; no real pool, account, host or path appears here.
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
  h = makeCcdHarness('ccrc-ccd-pool-a3-char-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  plantPoolEpoch(h.home, POOL_BY_ID);
});
afterEach(() => {
  for (const p of [regDir(), reg('pool-epoch')]) { try { fs.chmodSync(p, p === regDir() ? 0o755 : 0o644); } catch { /* absent */ } }
  h.cleanup();
});

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const PROJECT = 'project-a';
const ID = `claude-${PROJECT}`;
const PANE_PID = '4242';
const regDir = (): string => path.join(h.home, '.cc-sessions');
const reg = (f: string): string => path.join(regDir(), f);
const read = (f: string): string => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
/** The fixture HOME as `$HOME`, swap.log's date prefix dropped, and every epoch second as `<ts>`. */
const norm = (s: string): string => s.split(h.home).join('$HOME')
  .replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /gm, '').replace(/\b1\d{9}\b/g, '<ts>').trimEnd();
const lines = (s: string, word: string): string => s.split('\n').filter((l) => l.includes(word)).map(norm).join('\n');

const tagPool = (bytes: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), PROJECT), bytes);
};
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};
const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const seedRow = (wrapper: string, id = ID): string => {
  const wd = path.join(h.home, 'projects', PROJECT);
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${id} uuid ${UUID}
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} home ${wrapper}
    _reg_set ${id} project ${PROJECT}
    _reg_set ${id} workdir ${wd}
    _reg_set ${id} started 1`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};
const plantTranscript = (mdir: string): void => {
  const dir = path.join(h.home, '.claude', 'projects', mdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
};
/** Both streams, whatever the exit status (a warning on a zero exit is otherwise lost to `execFileSync`). */
const run = (snippet: string, env: NodeJS.ProcessEnv = {}): string => {
  const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 30000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }),
  });
  return `rc=${r.status ?? 1}\n${norm(String(r.stderr ?? ''))}`.trimEnd();
};
const NO_PANE = 'case "${1:-}" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac;';
const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ` tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} ${NO_PANE} return 0; }; sleep() { :; };`;
const START_STUBS = `${WS_ADD} _alive() { return 1; }; _have_systemctl() { return 1; };`;
const pane = (text: string): string => `
  tmux() { ${WIDE_PANE} case "\${1:-}" in
             capture-pane) printf '%s\\n' "${text}" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const QUIET = pane('❯ ');
const BLOCKED = pane('API Error: 429 Too Many Requests');
const calls = (): string => lines(read(path.join(h.home, 'ccd-calls')), 'dispatch');

// ── The states. Four project states of a session with no set, and three undecidable account states of a tagged one. ──
const STATES = {
  'untagged': (): void => {},
  'named pool-a': (): void => tagPool('pool-a\n'),
  'project unreadable': (): void => { fs.mkdirSync(path.join(reg('pools'), PROJECT), { recursive: true }); },
  'project malformed': (): void => tagPool('Pool-A\n'),
  'account unreadable': (): void => { tagPool('pool-a\n'); fs.rmSync(reg('pool-epoch')); fs.mkdirSync(reg('pool-epoch')); },
  'account stale': (): void => { tagPool('pool-a\n'); plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 }); },
  'account malformed': (): void => { tagPool('pool-a\n'); fs.writeFileSync(reg('pool-epoch'), 'not a projection\n'); },
  // Three more, from the plan's Step 1: the row's project field absent (`prjrc` 1), that field unreadable on a box with
  // no `$POOLS_DIR` (`_pool_untaggable`), and a `$REG` that cannot be searched.
  'project field absent': (): void => { tagPool('pool-a\n'); fs.rmSync(reg(`${ID}.project`), { force: true }); },
  'project field unreadable, no pools dir': (): void => {
    fs.rmSync(reg(`${ID}.project`), { force: true }); fs.mkdirSync(reg(`${ID}.project`));
  },
  '$REG unsearchable': (): void => { tagPool('pool-a\n'); fs.chmodSync(regDir(), 0o600); },
} as const;
type State = keyof typeof STATES;

/** Each user's answer, measured on a fresh fixture for one state. */
const USERS = {
  /** `_swap_target` for a row on `claude` whose home is `claude` and is at the ceiling: its destination and rc. */
  swapTarget: (s: State): string => {
    seedRow('claude'); STATES[s]();
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    writeLimits('claude', 99, 99);
    return h.sh(`out=$(_swap_target ${ID} claude claude); printf '%s|rc=%s' "$out" "$?"`);
  },
  /** The home re-seed and the affinity verb: a row on `claude-b` (pool-b) at home there, one quiet tick. */
  reseed: (s: State): string => {
    seedRow('claude-b'); STATES[s]();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 5, 5);
    h.sh(`${QUIET} _auto_swap_check ${ID}`);
    return [`home=${h.reg(ID, 'home') ?? ''}`, lines(read(reg('swap.log')), ' rehome '),
      `tickstuck=${norm(h.reg(ID, 'tickstuck') ?? '')}`, calls()].join('\n').trimEnd();
  },
  /** A pay-per-use lane in pool-a: whether `_default_pool` admits it. */
  payPerUse: (s: State): string => {
    seedAccountsSh(h.home, {
      ...POOLED_TEST_ROSTER,
      accounts: [...POOLED_TEST_ROSTER.accounts, {
        id: 'lane-d', label: 'lane·d', configDirSuffix: '.claude-lane-d',
        exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-d-openrouter.env' },
        homeAble: false, hue: 'amber', telemetry: 'openrouter', pool: 'pool-a',
      }],
    });
    plantPoolEpoch(h.home, { ...POOL_BY_ID, 'lane-d': 'pool-a' });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'lane-d'), '#!/bin/sh\n', { mode: 0o755 });
    seedRow('claude'); STATES[s]();
    return h.sh(`_default_pool ${ID}`).trim();
  },
  /** `_strand_why`'s one line. */
  strandWhy: (s: State): string => {
    seedRow('claude'); STATES[s]();
    return norm(h.sh(`_strand_why ${ID} ${PROJECT}`));
  },
  /** `_strand_mark` with no cause: the stranded record, its swap.log line and the banner. */
  strandMark: (s: State): string => {
    seedRow('claude'); STATES[s](); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_strand_mark ${ID} claude ${PROJECT}`);
    return [norm(h.reg(ID, 'stranded') ?? ''), lines(read(reg('swap.log')), ' stranded '),
      norm(read(path.join(h.home, 'notify-log')))].join('\n').trimEnd();
  },
  /** The tick on a hard-blocked row with every account at the ceiling: what it strands with, and the stuck word. */
  strandTick: (s: State): string => {
    seedRow('claude'); STATES[s](); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`${BLOCKED} _auto_swap_check ${ID}`);
    return [norm(h.reg(ID, 'stranded') ?? ''), `tickstuck=${norm(h.reg(ID, 'tickstuck') ?? '')}`,
      lines(read(reg('swap.log')), 'tick-undecidable'), calls()].join('\n').trimEnd();
  },
  /** `cmd_start` for a NEW row on `claude-b` (pool-b): refused or created. */
  startNew: (s: State): string => {
    STATES[s]();
    fs.mkdirSync(path.join(h.home, 'projects', PROJECT), { recursive: true });
    return `${run(`${START_STUBS} cmd_start claude-b ${PROJECT}`)}\ncreated=${fs.existsSync(reg(`claude-b-${PROJECT}.uuid`))}`;
  },
  /** `cmd_start` reviving an EXISTING row on `claude-b`: its warnings. */
  startExisting: (s: State): string => {
    seedRow('claude-b', `claude-b-${PROJECT}`); STATES[s]();
    return run(`${START_STUBS} cmd_start claude-b ${PROJECT}`).split('\n').filter((l) => l.startsWith('rc=') || l.includes('warn')).join('\n');
  },
  /** `cmd_swap` to `claude-b` (pool-b) with no flag. */
  swap: (s: State): string => {
    const mdir = seedRow('claude'); plantTranscript(mdir); STATES[s]();
    return `${run(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, { TMUX: '' })}\nwrapper=${h.reg(ID, 'wrapper')}`;
  },
  /** `cmd_prefer` to `claude-b` with no flag. */
  prefer: (s: State): string => {
    seedRow('claude'); STATES[s]();
    return `${run(`${SWAP_STUBS} cmd_prefer ${ID} claude-b`, { TMUX: '' })}\nhome=${h.reg(ID, 'home')}`;
  },
  /** `cmd_swap --cross-pool` to `claude-b`: the `cross-pool` swap.log line and the marker. */
  crossLog: (s: State): string => {
    const mdir = seedRow('claude'); plantTranscript(mdir); STATES[s]();
    run(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' });
    return [lines(read(reg('swap.log')), ' cross-pool '), `marker=${norm(h.reg(ID, 'crosspool') ?? '')}`].join('\n');
  },
} as const;
type User = keyof typeof USERS;

const EXPECTED: Record<State, Partial<Record<User, string>>> = {
  'untagged': {
    swapTarget: 'claude-a|rc=0',
    reseed: 'home=claude-b\n\ntickstuck=',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'no candidate',
    strandMark: '<ts> claude-a:limit claude-b:limit claude-d:limit\nstranded claude-project-a: claude (blocked) -> nowhere [pool=-] (claude-a:limit claude-b:limit claude-d:limit)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool (untagged) can take it — claude-a:limit claude-b:limit claude-d:limit',
    strandTick: '<ts> claude-a:limit claude-b:limit claude-d:limit\ntickstuck=',
    startNew: 'rc=0\ncreated=true',
    startExisting: 'rc=0',
    swap: 'rc=0\nwrapper=claude-b',
    prefer: 'rc=0\nhome=claude-b',
    crossLog: '\nmarker=',
  },
  'named pool-a': {
    swapTarget: 'claude-a|rc=0',
    reseed: 'home=claude\nrehome claude-project-a: home claude-b -> claude [pool=pool-a]\ntickstuck=',
    payPerUse: 'claude claude-a claude-b claude-d lane-d',
    strandWhy: 'claude-b:pool=pool-b',
    strandMark: '<ts> claude-a:limit claude-b:pool=pool-b claude-d:limit\nstranded claude-project-a: claude (blocked) -> nowhere [pool=pool-a] (claude-a:limit claude-b:pool=pool-b claude-d:limit)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool pool-a can take it — claude-a:limit claude-b:pool=pool-b claude-d:limit',
    strandTick: '<ts> claude-a:limit claude-b:pool=pool-b claude-d:limit\ntickstuck=',
    startNew: 'rc=1\nccd: pool-mismatch: claude-b is in pool \'pool-b\' (measured from the projection, $HOME/.cc-sessions/pool-epoch — not the declared roster) and project \'project-a\' is in pool \'pool-a\' — to cross on purpose: ccd start --cross-pool claude-b project-a\ncreated=false',
    startExisting: 'rc=0\nccd: warn: claude-b-project-a lives on claude-b, which is not in project \'project-a\'\'s pool \'pool-a\' — the auto-swapper relocates it at the next idle boundary',
    swap: 'rc=1\nccd: pool-mismatch: claude-b is in pool \'pool-b\' (measured from the projection, $HOME/.cc-sessions/pool-epoch — not the declared roster) and project \'project-a\' is in pool \'pool-a\' — to cross on purpose: ccd swap --cross-pool claude-project-a claude-b\nwrapper=claude',
    prefer: 'rc=1\nccd: pool-mismatch: claude-b is in pool \'pool-b\' (measured from the projection, $HOME/.cc-sessions/pool-epoch — not the declared roster) and project \'project-a\' is in pool \'pool-a\' — to cross on purpose: ccd prefer --cross-pool claude-project-a claude-b\nhome=claude',
    crossLog: 'cross-pool claude-project-a: claude -> claude-b [project=project-a pool=pool-a target-pool=pool-b]\nmarker=<ts> pool-a claude-b',
  },
  'project unreadable': {
    swapTarget: '|rc=4',
    reseed: 'home=claude-b\n\ntickstuck=<ts> pool',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'tag:unreadable $HOME/.cc-sessions/pools/project-a',
    strandMark: '<ts> tag:unreadable $HOME/.cc-sessions/pools/project-a\nstranded claude-project-a: claude (blocked) -> nowhere [pool=-] (tag:unreadable $HOME/.cc-sessions/pools/project-a)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool (untagged) can take it — tag:unreadable $HOME/.cc-sessions/pools/project-a',
    strandTick: '<ts> the project\'s pool tag could not be read ($HOME/.cc-sessions/pools/project-a), so no destination could be computed\ntickstuck=<ts> pool\ntick-undecidable claude-project-a: pool could not be measured — deciding nothing',
    startNew: 'rc=1\nccd: pool tag for project-a is unreadable: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\ncreated=false',
    startExisting: 'rc=0',
    swap: 'rc=1\nccd: pool tag for project-a is unreadable: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\nwrapper=claude',
    prefer: 'rc=1\nccd: pool tag for project-a is unreadable: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\nhome=claude',
    crossLog: '\nmarker=',
  },
  'project malformed': {
    swapTarget: '|rc=4',
    reseed: 'home=claude-b\n\ntickstuck=<ts> pool',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'tag:malformed $HOME/.cc-sessions/pools/project-a',
    strandMark: '<ts> tag:malformed $HOME/.cc-sessions/pools/project-a\nstranded claude-project-a: claude (blocked) -> nowhere [pool=-] (tag:malformed $HOME/.cc-sessions/pools/project-a)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool (untagged) can take it — tag:malformed $HOME/.cc-sessions/pools/project-a',
    strandTick: '<ts> the project\'s pool tag could not be read ($HOME/.cc-sessions/pools/project-a), so no destination could be computed\ntickstuck=<ts> pool\ntick-undecidable claude-project-a: pool could not be measured — deciding nothing',
    startNew: 'rc=1\nccd: pool tag for project-a is malformed: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\ncreated=false',
    startExisting: 'rc=0',
    swap: 'rc=1\nccd: pool tag for project-a is malformed: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\nwrapper=claude',
    prefer: 'rc=1\nccd: pool tag for project-a is malformed: $HOME/.cc-sessions/pools/project-a — fix or clear it; nothing was touched\nhome=claude',
    crossLog: '\nmarker=',
  },
  'account unreadable': {
    swapTarget: '|rc=7',
    reseed: 'home=claude-b\n\ntickstuck=<ts> projection',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'projection:unreadable $HOME/.cc-sessions/pool-epoch',
    strandMark: '<ts> projection:unreadable $HOME/.cc-sessions/pool-epoch\nstranded claude-project-a: claude (blocked) -> nowhere [pool=pool-a] (projection:unreadable $HOME/.cc-sessions/pool-epoch)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool pool-a can take it — projection:unreadable $HOME/.cc-sessions/pool-epoch',
    strandTick: '<ts> the pool projection could not be read ($HOME/.cc-sessions/pool-epoch), so no destination could be computed; the remedy is the pool sync and the control-plane link, not the project tag\ntickstuck=<ts> projection\ntick-undecidable claude-project-a: projection could not be measured — deciding nothing',
    startNew: 'rc=1\nccd: the pool projection for claude-b is unreadable: $HOME/.cc-sessions/pool-epoch is absent or unreadable — this node may never have synced; check that and the file\'s permissions; project \'project-a\' is tagged and its tag reads fine; nothing was touched\ncreated=false',
    startExisting: 'rc=0',
    swap: 'rc=1\nccd: the pool projection for claude-b is unreadable: $HOME/.cc-sessions/pool-epoch is absent or unreadable — this node may never have synced; check that and the file\'s permissions; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nwrapper=claude',
    prefer: 'rc=1\nccd: the pool projection for claude-b is unreadable: $HOME/.cc-sessions/pool-epoch is absent or unreadable — this node may never have synced; check that and the file\'s permissions; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nhome=claude',
    crossLog: '\nmarker=',
  },
  'account stale': {
    swapTarget: '|rc=7',
    reseed: 'home=claude-b\n\ntickstuck=<ts> projection',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'projection:stale $HOME/.cc-sessions/pool-epoch',
    strandMark: '<ts> projection:stale $HOME/.cc-sessions/pool-epoch\nstranded claude-project-a: claude (blocked) -> nowhere [pool=pool-a] (projection:stale $HOME/.cc-sessions/pool-epoch)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool pool-a can take it — projection:stale $HOME/.cc-sessions/pool-epoch',
    strandTick: '<ts> the pool projection could not be read ($HOME/.cc-sessions/pool-epoch), so no destination could be computed; the remedy is the pool sync and the control-plane link, not the project tag\ntickstuck=<ts> projection\ntick-undecidable claude-project-a: projection could not be measured — deciding nothing',
    startNew: 'rc=1\nccd: the pool projection for claude-b is stale: $HOME/.cc-sessions/pool-epoch is past its lease — the remedy is the control-plane link (the pool sync), not this file; project \'project-a\' is tagged and its tag reads fine; nothing was touched\ncreated=false',
    startExisting: 'rc=0',
    swap: 'rc=1\nccd: the pool projection for claude-b is stale: $HOME/.cc-sessions/pool-epoch is past its lease — the remedy is the control-plane link (the pool sync), not this file; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nwrapper=claude',
    prefer: 'rc=1\nccd: the pool projection for claude-b is stale: $HOME/.cc-sessions/pool-epoch is past its lease — the remedy is the control-plane link (the pool sync), not this file; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nhome=claude',
    crossLog: '\nmarker=',
  },
  'account malformed': {
    swapTarget: '|rc=7',
    reseed: 'home=claude-b\n\ntickstuck=<ts> projection',
    payPerUse: 'claude claude-a claude-b claude-d',
    strandWhy: 'projection:malformed $HOME/.cc-sessions/pool-epoch',
    strandMark: '<ts> projection:malformed $HOME/.cc-sessions/pool-epoch\nstranded claude-project-a: claude (blocked) -> nowhere [pool=pool-a] (projection:malformed $HOME/.cc-sessions/pool-epoch)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool pool-a can take it — projection:malformed $HOME/.cc-sessions/pool-epoch',
    strandTick: '<ts> the pool projection could not be read ($HOME/.cc-sessions/pool-epoch), so no destination could be computed; the remedy is the pool sync and the control-plane link, not the project tag\ntickstuck=<ts> projection\ntick-undecidable claude-project-a: projection could not be measured — deciding nothing',
    startNew: 'rc=1\nccd: the pool projection for claude-b is malformed: $HOME/.cc-sessions/pool-epoch is off the grammar — re-sync or remove it; project \'project-a\' is tagged and its tag reads fine; nothing was touched\ncreated=false',
    startExisting: 'rc=0',
    swap: 'rc=1\nccd: the pool projection for claude-b is malformed: $HOME/.cc-sessions/pool-epoch is off the grammar — re-sync or remove it; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nwrapper=claude',
    prefer: 'rc=1\nccd: the pool projection for claude-b is malformed: $HOME/.cc-sessions/pool-epoch is off the grammar — re-sync or remove it; project \'project-a\' is tagged and its tag reads fine; nothing was touched\nhome=claude',
    crossLog: '\nmarker=',
  },
  'project field absent': {
    swapTarget: 'claude-a|rc=0',
    reseed: 'home=claude-b\n\ntickstuck=',
    strandWhy: 'claude-b:pool=pool-b',
    strandMark: '<ts> claude-a:limit claude-b:pool=pool-b claude-d:limit\nstranded claude-project-a: claude (blocked) -> nowhere [pool=pool-a] (claude-a:limit claude-b:pool=pool-b claude-d:limit)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool pool-a can take it — claude-a:limit claude-b:pool=pool-b claude-d:limit',
    strandTick: '<ts> claude-a:limit claude-b:limit claude-d:limit\ntickstuck=',
    swap: 'rc=0\nwrapper=claude-b',
    prefer: 'rc=0\nhome=claude-b',
    crossLog: '\nmarker=',
  },
  'project field unreadable, no pools dir': {
    swapTarget: 'claude-a|rc=0',
    reseed: 'home=claude-b\n\ntickstuck=',
    strandWhy: 'no candidate',
    strandMark: '<ts> claude-a:limit claude-b:limit claude-d:limit\nstranded claude-project-a: claude (blocked) -> nowhere [pool=-] (claude-a:limit claude-b:limit claude-d:limit)\ncc swap STRANDED: claude-project-a is blocked on claude and no account in pool (untagged) can take it — claude-a:limit claude-b:limit claude-d:limit',
    strandTick: '<ts> claude-a:limit claude-b:limit claude-d:limit\ntickstuck=',
    swap: 'rc=0\nwrapper=claude-b',
    prefer: 'rc=0\nhome=claude-b',
    crossLog: '\nmarker=',
  },
  '$REG unsearchable': {
    swapTarget: '|rc=3',
    strandWhy: 'tag:unreadable $HOME/.cc-sessions/pools/project-a',
    payPerUse: 'claude claude-a claude-b claude-d',
  },
};

/** The users a state applies to: the field states need a row (no new-row start), and an unsearchable `$REG` lets only the
 *  readers that answer without writing to it be measured (a write or a field read there fails before the pool is asked). */
const ALL = Object.keys(USERS) as User[];
const FIELD_USERS = ALL.filter((u) => u !== 'startNew' && u !== 'startExisting' && u !== 'payPerUse');
const USERS_OF = (s: State): readonly User[] => {
  if (s === '$REG unsearchable') return ['swapTarget', 'strandWhy', 'payPerUse'];
  if (s === 'project field absent' || s === 'project field unreadable, no pools dir') return FIELD_USERS;
  return ALL;
};

describe.each(Object.keys(STATES) as State[])('a session with no set, %s: every user answers as on main', (s) => {
  it.each(USERS_OF(s))('%s', (u) => {
    const got = USERS[u](s);
    expect(got).toBe(EXPECTED[s][u]);
  });
});

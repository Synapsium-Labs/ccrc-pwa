// The lane-failing mark and the gates that read it (the provider-failure ladder, wave 3a; plan
// docs/superpowers/plans/2026-11-25-provider-retry.md).
//
// `$REG/<lane>-provfail` holds `<epoch> <err>`: several sessions' turn markers say this lane's provider answers with errors. Its
// one writer is the fleet limit watchdog's pass (`_provfail_pass`), and no session is moved by anything here. The mark costs a
// lane PREFERENCE in an automatic move and nothing else: a home that is marked is not returned to, a marked candidate ranks
// behind every other but a dead credential, and the operator's own verbs never read it.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). The pass takes its clock as an argument, and the verb's is ccd's own seam (`FAKE_NOW`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, ccdSource, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-provider-fail-'); });
afterEach(() => { h.cleanup(); });
afterEach(() => { expect(h.calls().filter((l) => /send-keys|paste-buffer/.test(l)), 'a key was sent').toEqual([]); });

const T0 = 1_900_000_000;
const MIN = 60;
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const markFile = (lane: string): string => regFile(`${lane}-provfail`);
const mark = (lane: string, body = `${T0} server_error`): void => fs.writeFileSync(markFile(lane), body);
const markOf = (lane: string): string | null => (fs.existsSync(markFile(lane)) ? fs.readFileSync(markFile(lane), 'utf8') : null);
const marks = (): string[] => fs.readdirSync(regFile('.')).filter((n) => n.includes('provfail')).sort();
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const nowS = (): number => Math.floor(Date.now() / 1000);
const uuidOf = (id: string): string => `uuid-${id}`;

interface Mark {
  state?: string; event?: string; sessionId?: string; at?: number; turnAt?: number | null; stopAt?: number | null; err?: string | null;
  failAts?: readonly number[] | string;
}
/** The hook's line, in the hook's key order. Stamps are given in SECONDS and written in ms, as the hook writes them. */
const markerLine = (id: string, m: Mark): string => {
  const ms = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : v * 1000);
  return `${JSON.stringify({
    v: 1, sessionId: m.sessionId ?? uuidOf(id), state: m.state ?? 'failed', event: m.event ?? 'StopFailure', at: (m.at ?? T0) * 1000, turnAt: ms(m.turnAt),
    stopAt: ms(m.stopAt), bg: 0, bgKinds: '', bgIds: '', err: m.err === undefined ? 'server_error' : m.err, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '',
    crons: 0, failAts: typeof m.failAts === 'string' ? m.failAts : (m.failAts ?? []).map((t) => t * 1000),
  })}\n`;
};
const row = (id: string, lane: string, m: Mark | null, o: { lastswap?: string } = {}): void => {
  const put = (f: string, v: string): void => fs.writeFileSync(regFile(`${id}.${f}`), v);
  put('uuid', uuidOf(id)); put('wrapper', lane); put('project', 'project-a');
  if (o.lastswap !== undefined) put('lastswap', o.lastswap);
  if (m !== null) fs.writeFileSync(regFile(`${id}.turn.json`), markerLine(id, m));
};
/** A session with these counted failures (seconds before `T0`), the newest owed. */
const failing = (...ago: number[]): Mark => ({ turnAt: T0 - Math.max(...ago) - 5, stopAt: T0 - Math.min(...ago), failAts: ago.map((a) => T0 - a) });
/** A session whose last turn ended well this many seconds before `T0`. */
const good = (ago: number, m: Mark = {}): Mark => ({ state: 'done', event: 'Stop', turnAt: T0 - ago - 30, stopAt: T0 - ago, err: null, failAts: [], ...m });
const pass = (now = T0): string => h.sh(`shopt -s nullglob; _provfail_pass ${now}; echo done`);

// ── the reader ──────────────────────────────────────────────────────────────

describe('_provfail: whether a lane is marked', () => {
  const read = (now = T0): boolean => h.sh(`_provfail claude ${now} && echo yes || echo no`) === 'yes';

  it.each<[string, string, number, boolean]>([
    ['just written', `${T0} server_error`, T0, true],
    ['29 min 59 s old', `${T0} overloaded`, T0 + 30 * MIN - 1, true],
    ['30 min old: it means nothing, whether or not the writer cleared it', `${T0} server_error`, T0 + 30 * MIN, false],
    ['an hour ahead of this clock: it would never age out', `${T0 + 3600} server_error`, T0, false],
    ['a few seconds ahead (the clock stepped back)', `${T0 + 5} server_error`, T0, true],
    ['empty', '', T0, false],
    ['a truncated write: the epoch alone', `${T0}`, T0, false],
    ['not an epoch', 'soon server_error', T0, false],
    ['a leading space', ` ${T0} server_error`, T0, false],
    ['an error word with bytes outside the token', `${T0} Server Error`, T0, false],
  ])('%s', (_name, body, now, want) => { mark('claude', body); expect(read(now)).toBe(want); });

  it('no file, a directory, a symlink and a FIFO are no mark, and none of them blocks', () => {
    expect(read()).toBe(false);
    fs.mkdirSync(markFile('claude'));
    expect(read()).toBe(false);
    fs.rmdirSync(markFile('claude'));
    fs.writeFileSync(regFile('elsewhere'), `${T0} server_error`); fs.symlinkSync(regFile('elsewhere'), markFile('claude'));
    expect(read()).toBe(false);
    fs.rmSync(markFile('claude'));
    execFileSync('mkfifo', [markFile('claude')]);
    expect(read()).toBe(false);
  });
});

// ── the writer: what sets a mark ────────────────────────────────────────────

describe('_provfail_pass: one session with three counted failures', () => {
  it('three since its last move, inside 2 h, sets the mark, with the pass\'s epoch and the failure\'s word', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    pass();
    expect(markOf('claude')).toBe(`${T0} server_error`);
    expect(marks()).toEqual(['claude-provfail']);
    expect(swapLog()).toMatch(/ lane-failing claude: /);
  });

  it('a session mid-retry (a turn newer than its failures) is still three in a row', () => {
    row('s-a', 'claude', { ...failing(6 * MIN, 5 * MIN, 60), state: 'working', turnAt: T0 - 10 });
    pass();
    expect(markOf('claude')).not.toBeNull();
  });

  it('`overloaded` is kept as the word', () => {
    row('s-a', 'claude', { ...failing(6 * MIN, 5 * MIN, 60), err: 'overloaded' });
    pass();
    expect(markOf('claude')).toBe(`${T0} overloaded`);
  });

  it('a later failure of another kind, or with no word at all, still leaves a mark its own reader takes', () => {
    row('s-a', 'claude', { ...failing(6 * MIN, 5 * MIN, 60), err: '' });
    row('s-b', 'claude-a', { ...failing(6 * MIN, 5 * MIN, 60), err: 'rate_limit' });
    pass();
    expect(markOf('claude')).toBe(`${T0} unknown`);
    expect(markOf('claude-a')).toBe(`${T0} rate_limit`);
    expect(h.sh(`_provfail claude ${T0} && _provfail claude-a ${T0} && echo yes || echo no`)).toBe('yes');
  });

  it.each<[string, Mark, { lastswap?: string }]>([
    ['two failures', failing(5 * MIN, 60), {}],
    ['one of the three is older than the last move, so it was another lane\'s', failing(6 * MIN, 5 * MIN, 60), { lastswap: String(T0 - 5 * MIN - 30) }],
    ['one of the three is older than 2 h', failing(7201, 5 * MIN, 60), {}],
    ['the newest is older than the mark would last', failing(50 * MIN, 45 * MIN, 31 * MIN), {}],
    ['stamps ahead of this clock', failing(-7200, -7100, -7000), {}],
    ['a `lastswap` that is no epoch: which lane the failures were on is unmeasured', failing(6 * MIN, 5 * MIN, 60), { lastswap: 'soon' }],
  ])('%s: no mark', (_name, m, o) => { row('s-a', 'claude', m, o); pass(); expect(marks()).toEqual([]); });

  it('a `lastswap` that cannot be read is unmeasured too', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    fs.mkdirSync(regFile('s-a.lastswap'));
    pass();
    expect(marks()).toEqual([]);
  });

  it('a lane outside the roster is never marked', () => {
    row('s-a', 'not-a-lane', failing(6 * MIN, 5 * MIN, 60));
    pass();
    expect(marks()).toEqual([]);
  });

  it('a row whose wrapper cannot be read is on no lane', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    fs.rmSync(regFile('s-a.wrapper')); fs.mkdirSync(regFile('s-a.wrapper'));
    pass();
    expect(marks()).toEqual([]);
  });
});

describe('_provfail_pass: two sessions with a fresh owed failure', () => {
  it('two on one lane set it; the newest failure names the word', () => {
    row('s-a', 'claude', failing(60));
    row('s-b', 'claude', { ...failing(30), err: 'overloaded' });
    pass();
    expect(markOf('claude')).toBe(`${T0} overloaded`);
    fs.rmSync(markFile('claude'));
    row('s-a', 'claude', { ...failing(30), err: 'overloaded' }); row('s-b', 'claude', failing(60));
    pass();
    expect(markOf('claude'), 'in the other row order').toBe(`${T0} overloaded`);
  });

  it.each<[string, Mark, string, { lastswap?: string }]>([
    ['alone', good(90), 'claude-a', {}],
    ['the other is on another lane', failing(30), 'claude-a', {}],
    ['the other\'s is older than 10 min', failing(10 * MIN + 1), 'claude', {}],
    ['the other has started a turn since: it owes none', { ...failing(30), state: 'working', turnAt: T0 - 10 }, 'claude', {}],
    ['the other\'s was before it moved here', failing(30), 'claude', { lastswap: String(T0 - 20) }],
  ])('one, and %s: no mark', (_name, m, lane, o) => {
    row('s-a', 'claude', failing(60));
    row('s-b', lane, m, o);
    pass();
    expect(marks()).toEqual([]);
  });
});

describe('_provfail_pass: a newer good Stop on the lane is health', () => {
  const three = (): void => row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
  const other = (m: Mark | null, lane = 'claude', o: { lastswap?: string } = {}): void => { three(); row('s-b', lane, m, o); pass(); };

  it.each<[string, Mark]>([
    ['a Stop', good(30)],
    ['a Stop whose session is already on its next turn', good(30, { state: 'working', event: 'UserPromptSubmit', turnAt: T0 - 10 })],
    ['a Stop after an earlier provider failure of its own, on its next turn (the hook keeps the word and empties the list)',
      good(30, { state: 'working', event: 'PreToolUse', turnAt: T0 - 10, err: 'server_error' })],
    ['a Stop a restart relabelled', good(30, { event: 'SessionStart' })],
    ['a Stop after a failure of another kind (the hook keeps its word)', good(30, { err: 'rate_limit' })],
  ])('%s, newer than the failures: no mark', (_name, m) => { other(m); expect(marks()).toEqual([]); });

  it('the newest of two good Stops is the one that counts, in either row order', () => {
    three(); row('s-b', 'claude', good(30)); row('s-c', 'claude', good(90));
    pass();
    expect(marks()).toEqual([]);
    row('s-b', 'claude', good(90)); row('s-c', 'claude', good(30));
    pass();
    expect(marks()).toEqual([]);
  });

  it.each<[string, Mark | null, string, { lastswap?: string }]>([
    ['a Stop older than the newest failure', good(90), 'claude', {}],
    ['a Stop on another lane', good(30), 'claude-a', {}],
    ['a Stop from before its session moved to this lane', good(30), 'claude', { lastswap: String(T0 - 20) }],
    ['a turn that failed on another kind of error', good(30, { state: 'failed', event: 'StopFailure', err: 'rate_limit' }), 'claude', {}],
    ['that failure after a restart relabelled it `done`', good(30, { event: 'SessionStart', err: 'rate_limit' }), 'claude', {}],
    ['a failure with no word, after a restart', good(30, { event: 'SessionStart', err: '' }), 'claude', {}],
    ['a clear: no Stop at all', good(30, { event: 'SessionStart', stopAt: null }), 'claude', {}],
    ['another conversation\'s line', good(30, { sessionId: 'uuid-other' }), 'claude', {}],
    ['a Stop ahead of this clock', good(-7200), 'claude', {}],
    ['no marker', null, 'claude', {}],
  ])('%s is no health: the mark is set', (_name, m, lane, o) => { other(m, lane, o); expect(markOf('claude')).not.toBeNull(); });
});

describe('_provfail_pass: a marker that cannot be read is evidence of nothing', () => {
  const turn = (): string => regFile('s-a.turn.json');

  it.each<[string, () => void]>([
    ['absent', () => fs.rmSync(turn())],
    ['a directory', () => { fs.rmSync(turn()); fs.mkdirSync(turn()); }],
    ['a symlink', () => { fs.renameSync(turn(), regFile('elsewhere')); fs.symlinkSync(regFile('elsewhere'), turn()); }],
    ['not the hook\'s line', () => fs.writeFileSync(turn(), 'server_error\n')],
    ['over the size bound', () => fs.writeFileSync(turn(), fs.readFileSync(turn(), 'utf8').replace('"bgIds":""', `"bgIds":"${'a'.repeat(4096)}"`))],
    ['a `failAts` that is no list of epochs', () => fs.writeFileSync(turn(), markerLine('s-a', { ...failing(60), failAts: 'x' }))],
    ['another conversation\'s', () => fs.writeFileSync(turn(), markerLine('s-a', { ...failing(6 * MIN, 5 * MIN, 60), sessionId: 'uuid-other' }))],
    ['a row with no uuid, and a line with no session id', () => {
      fs.writeFileSync(regFile('s-a.uuid'), '');
      fs.writeFileSync(turn(), markerLine('s-a', { ...failing(6 * MIN, 5 * MIN, 60), sessionId: '' }));
    }],
  ])('%s: never failure', (_name, spoil) => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    spoil();
    pass();
    expect(marks()).toEqual([]);
  });

  it.each<[string, (f: string) => void]>([
    ['not the hook\'s line', (f) => fs.writeFileSync(f, 'Stop\n')],
    ['a directory', (f) => { fs.rmSync(f); fs.mkdirSync(f); }],
    ['no `failAts` and a word that may be any failure\'s', (f) => fs.writeFileSync(f, markerLine('s-b', good(10, { event: 'SessionStart', err: 'rate_limit' })).replace(',"failAts":[]', ''))],
  ])('%s: never health, so a standing mark stays', (_name, spoil) => {
    mark('claude');
    row('s-b', 'claude', good(-60));
    spoil(regFile('s-b.turn.json'));
    pass(T0 + 2 * MIN);
    expect(markOf('claude')).toBe(`${T0} server_error`);
  });
});

// ── the writer: what clears a mark ──────────────────────────────────────────

describe('_provfail_pass: the mark ends', () => {
  it('on a newer good Stop on that lane', () => {
    mark('claude'); mark('claude-a');
    row('s-a', 'claude', good(-60));
    pass(T0 + 2 * MIN);
    expect(marks()).toEqual(['claude-a-provfail']);
    expect(swapLog()).toMatch(/ lane-failing-end claude: a turn ended well/);
  });

  it('not on one older than the mark, and not on one from another lane', () => {
    mark('claude');
    row('s-a', 'claude', good(60)); row('s-b', 'claude-a', good(-60));
    pass(T0 + 2 * MIN);
    expect(markOf('claude')).toBe(`${T0} server_error`);
  });

  it('30 minutes after it was written, with every session of the lane gone', () => {
    mark('claude');
    pass(T0 + 30 * MIN - 1);
    expect(markOf('claude')).not.toBeNull();
    pass(T0 + 30 * MIN);
    expect(marks()).toEqual([]);
  });

  it('a lane that left the roster and a malformed mark are swept the same way; a directory in its place is left', () => {
    mark('gone-lane', `${T0 - 3600} server_error`); mark('claude-a', 'garbage'); fs.mkdirSync(markFile('claude-b'));
    pass();
    expect(marks()).toEqual(['claude-b-provfail']);
  });

  it('a standing mark is not rewritten by a newer failure: the 30 minutes run from the write', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    pass();
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60, -10 * MIN));
    pass(T0 + 11 * MIN);
    expect(markOf('claude')).toBe(`${T0} server_error`);
  });

  it('at 30 minutes it is written again only while a failure inside them still stands', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    pass();
    pass(T0 + 30 * MIN);
    expect(marks(), 'no failure since the write').toEqual([]);
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60, -16 * MIN));
    mark('claude');
    pass(T0 + 30 * MIN);
    expect(markOf('claude')).toBe(`${T0 + 30 * MIN} server_error`);
  });

  it('a failure newer than the good Stop that ended a mark sets it again in the same pass', () => {
    mark('claude');
    row('s-a', 'claude', good(-60));
    row('s-b', 'claude', failing(6 * MIN, 5 * MIN, -90));
    pass(T0 + 2 * MIN);
    expect(markOf('claude')).toBe(`${T0 + 2 * MIN} server_error`);
  });

  it('two lanes are judged apart in one pass, and the pass leaves no temp', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    row('s-b', 'claude-a', failing(40)); row('s-c', 'claude-a', failing(50));
    row('s-d', 'claude-b', failing(50)); row('s-e', 'claude-b', good(20));
    pass();
    expect(marks()).toEqual(['claude-a-provfail', 'claude-provfail']);
  });

  it('a mark that cannot be put in place leaves no temp and says nothing', () => {
    fs.mkdirSync(markFile('claude'));
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    pass();
    expect(marks()).toEqual(['claude-provfail']);
    expect(swapLog()).not.toContain('lane-failing');
  });
});

describe('the pass is the limit watchdog\'s', () => {
  const verb = (env: NodeJS.ProcessEnv = {}): string => h.sh(
    `date() { if [[ "\${1:-}" == +%s ]]; then echo ${T0}; else command date "$@"; fi; }
     _watchdog_one() { echo "one $1" >> "$HOME/ccd-calls"; }; cmd_limit_watchdog`, env);

  it('a pass of the verb writes the mark before it asks about any session, and moves none', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    h.sh(`date() { if [[ "\${1:-}" == +%s ]]; then echo ${T0}; else command date "$@"; fi; }
          _watchdog_one() { [[ -e "$REG/claude-provfail" ]] && echo marked >> "$HOME/ccd-calls"; }; cmd_limit_watchdog`);
    expect(markOf('claude')).toBe(`${T0} server_error`);
    expect(h.calls()).toEqual(['marked']);
    expect(h.reg('s-a', 'wrapper')).toBe('claude');
    expect(h.reg('s-a', 'lastswap')).toBeNull();
  });

  it('`CCRC_LIMIT_WATCHDOG_MIN=0` reads and writes nothing, the mark included', () => {
    row('s-a', 'claude', failing(6 * MIN, 5 * MIN, 60));
    verb({ CCRC_LIMIT_WATCHDOG_MIN: '0' });
    expect(marks()).toEqual([]);
  });

  it('it has one writer: no other body in ccd names the file but the reader and the home gate', () => {
    const src = ccdSource();
    const named = [...src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{[\s\S]*?^\}$/gm)]
      .filter((m) => m[0].split('\n').some((l) => !/^\s*#/.test(l) && /-provfail/.test(l.replace(/\s#\s.*$/, '')))).map((m) => m[1]);
    expect(named.sort()).toEqual(['_provfail', '_provfail_holds_home', '_provfail_pass']);
    const callers = [...src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{[\s\S]*?^\}$/gm)]
      .filter((m) => m[0].split('\n').some((l) => /\b_provfail_pass\b/.test(l.replace(/(^|\s)#.*$/, '')) && !l.startsWith('_provfail_pass()'))).map((m) => m[1]);
    expect(callers).toEqual(['cmd_limit_watchdog']);
  });

  it('reads what the hook\'s own jq program writes: three failures mark the lane, the Stop after them clears it', () => {
    const hook = fs.readFileSync(path.resolve(__dirname, '../../ccd/session-hook.sh'), 'utf8');
    const program = /^TURN_MARK_PROGRAM='([^']*)'$/m.exec(hook)?.[1];
    expect(program).toBeTruthy();
    row('s-a', 'claude', null);
    let prev = '';
    const ev = (kind: string, event: string, atS: number, err = ''): void => {
      prev = execFileSync('jq', ['-cn', '--arg', 'prev', prev, '--arg', 'kind', kind, '--arg', 'sid', uuidOf('s-a'), '--arg', 'ev', event,
        '--argjson', 'at', String(atS * 1000), '--argjson', 'bg', '0', '--argjson', 'crons', '0', '--arg', 'bgk', '', '--arg', 'bgi', '', '--arg', 'err', err, program!],
      { encoding: 'utf8' });
      fs.writeFileSync(regFile('s-a.turn.json'), prev);
    };
    ev('working', 'UserPromptSubmit', T0 - 400); ev('failed', 'StopFailure', T0 - 390, 'server_error');
    ev('working', 'UserPromptSubmit', T0 - 330); ev('failed', 'StopFailure', T0 - 320, 'overloaded');
    pass();
    expect(marks()).toEqual([]);
    ev('working', 'UserPromptSubmit', T0 - 70); ev('failed', 'StopFailure', T0 - 60, 'overloaded');
    ev('restart', 'SessionStart', T0 - 30);
    pass();
    expect(markOf('claude')).toBe(`${T0} overloaded`);
    ev('working', 'UserPromptSubmit', T0 + 60); ev('done', 'Stop', T0 + 90); ev('working', 'UserPromptSubmit', T0 + 100);
    pass(T0 + 2 * MIN);
    expect(marks()).toEqual([]);
  });
});

// ── the gates ───────────────────────────────────────────────────────────────

describe('the gates in an automatic move\'s target', () => {
  const ID = 'claude-demo';
  const limits = (w: string, five: number, seven = five): void =>
    fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: nowS() }));
  const now = (): string => `${nowS()} server_error`;
  const away = (wrapper: string, home = 'claude'): void => {
    for (const [f, v] of [['uuid', 'u'], ['wrapper', wrapper], ['home', home], ['project', 'project-a']] as const) fs.writeFileSync(regFile(`${ID}.${f}`), v);
  };
  const aged = (f: string, s: number): void => { const t = new Date(Date.now() - s * 1000); fs.utimesSync(regFile(f), t, t); };
  const target = (cur: string, force = '', pre = ''): string => h.sh(`${pre} _swap_target ${ID} ${cur} claude '${force}' 0 || true`);

  it('a recovered home that is marked is not returned to; the session stays where it works', () => {
    away('claude-b'); limits('claude', 5); limits('claude-b', 40);
    expect(target('claude-b'), 'control: an unmarked home').toBe('claude');
    mark('claude', now()); aged(`${ID}.home`, 3600);
    expect(target('claude-b')).toBe('');
    mark('claude', `${nowS() - 30 * MIN} server_error`);
    expect(target('claude-b'), 'a mark past its 30 minutes holds nothing').toBe('claude');
  });

  it('a session already on its marked home is not moved off it', () => {
    away('claude'); limits('claude', 5); limits('claude-a', 5); mark('claude', now());
    expect(target('claude')).toBe('');
  });

  it('a forced rescue passes over a marked home for another lane with room, and takes it when there is no other', () => {
    away('claude-b'); limits('claude', 5); limits('claude-b', 99); limits('claude-a', 60); limits('claude-d', 70);
    expect(target('claude-b', '1'), 'control').toBe('claude');
    mark('claude', now()); aged(`${ID}.home`, 3600);
    expect(target('claude-b', '1')).toBe('claude-a');
    limits('claude-a', 99); limits('claude-d', 99);
    expect(target('claude-b', '1')).toBe('claude');
  });

  it('a limit rescue is never refused: a marked home outside the session\'s own pool list is still the fallback', () => {
    away('claude-b'); fs.writeFileSync(regFile(`${ID}.pool`), 'claude-a claude-b');
    limits('claude', 5); limits('claude-b', 99); limits('claude-a', 99); mark('claude', now()); aged(`${ID}.home`, 3600);
    expect(target('claude-b', '1')).toBe('claude');
  });

  it('a relocation off a wrong-pool lane is a must-leave too: it falls back on the marked home', () => {
    fs.mkdirSync(regFile('pools'), { recursive: true });
    away('claude-b'); fs.writeFileSync(regFile(`${ID}.pool`), 'claude-b');
    limits('claude', 5); limits('claude-b', 5); mark('claude', now()); aged(`${ID}.home`, 3600);
    // The current account is off the project's pool; home is in it.
    expect(target('claude-b', '', '_pool_ok() { [[ "$1" != claude-b ]]; };')).toBe('claude');
  });

  it('a marked candidate ranks after measured and after unmeasured, and is taken when it is the only one', () => {
    away('claude'); limits('claude', 99); limits('claude-a', 5); limits('claude-b', 90); limits('claude-d', 99);
    expect(target('claude'), 'control').toBe('claude-a');
    mark('claude-a', now());
    expect(target('claude')).toBe('claude-b');
    fs.rmSync(path.join(h.home, '.cc-limits', 'claude-b.json'));
    expect(target('claude'), 'unmeasured beats marked').toBe('claude-b');
    limits('claude-b', 99);
    expect(target('claude'), 'the only one with room').toBe('claude-a');
  });

  it('a marked lane still beats one whose credential is dead, whatever the roster order', () => {
    away('claude'); limits('claude', 99); limits('claude-a', 5); limits('claude-b', 5); limits('claude-d', 99);
    fs.writeFileSync(regFile('claude-a-authdead'), `${nowS()} auth-401`); mark('claude-b', now());
    expect(target('claude')).toBe('claude-b');
    fs.rmSync(regFile('claude-a-authdead')); fs.rmSync(markFile('claude-b'));
    mark('claude-a', now()); fs.writeFileSync(regFile('claude-b-authdead'), `${nowS()} auth-401`);
    expect(target('claude')).toBe('claude-a');
  });

  it('every lane marked: the rescue still goes, by score', () => {
    away('claude'); limits('claude', 99); limits('claude-a', 50); limits('claude-b', 20); limits('claude-d', 60);
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) mark(w, now());
    expect(target('claude', '1')).toMatch(/^claude-[abd]$/);
  });

  it('the spread preference does not buy a marked lane: a rescue lands on the lane with room another one just took', () => {
    away('claude'); limits('claude', 99); limits('claude-a', 20); limits('claude-b', 30); limits('claude-d', 99);
    const at = new Date(Date.now() - 60_000);
    const p = (n: number): string => String(n).padStart(2, '0');
    const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
    fs.writeFileSync(regFile('swap.log'), `${stamp} auto-rescue other-demo: claude-d (blocked) -> claude-a [home=claude]\n`);
    const rescue = (): string => h.sh(`_rescue_target ${ID} claude claude 1 0 || true`);
    expect(rescue(), 'control: spread passes over the lane just rescued onto').toBe('claude-b');
    mark('claude-b', now());
    expect(rescue()).toBe('claude-a');
  });
});

// ── the operator's verbs ────────────────────────────────────────────────────

describe('the operator\'s own verbs never read the mark (ruling 2026-10-19)', () => {
  const ID = 'claude-demo';
  const limits = (w: string, five: number): void =>
    fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven: five, ts: nowS() }));
  const at = (f: string, s: number): void => { const t = new Date(Date.now() + s * 1000); fs.utimesSync(regFile(f), t, t); };

  it.each(['cmd_swap', 'cmd_swap_self', 'cmd_prefer', 'cmd_start', 'cmd_ensure'])('%s names neither the mark nor its readers', (name) => {
    const src = ccdSource();
    const open = src.indexOf(`\n${name}() {`);
    const body = src.slice(open, src.indexOf('\n}\n', open)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(open).toBeGreaterThan(0);
    expect(body).not.toMatch(/provfail|_provider_move|_swap_target|_rescue_target/);
  });

  const setup = (): void => {
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude-b'], ['home', 'claude-b'], ['project', 'project-a']] as const) fs.writeFileSync(regFile(`${ID}.${f}`), v);
    limits('claude', 5); limits('claude-b', 40);
    mark('claude', `${nowS()} server_error`); at('claude-provfail', -60);
  };
  const target = (): string => h.sh(`_swap_target ${ID} claude-b claude '' 0 || true`);

  it('`ccd prefer` onto a marked lane is accepted, and the return it asks for is not held back by the mark that stood', () => {
    setup();
    expect(h.sh(`cmd_prefer ${ID} claude`)).toContain(`home for ${ID} set to claude`);
    expect(target()).toBe('claude');
  });

  it('a move decided and put back (a requeue restores `lastswap`) leaves the choice standing', () => {
    setup();
    h.sh(`cmd_prefer ${ID} claude; _reg_set ${ID} lastswap ${nowS() - 5000}`);
    expect(target()).toBe('claude');
  });

  it('the choice is one move: a session moved since it was made is held by the mark like any other', () => {
    setup();
    h.sh(`cmd_prefer ${ID} claude; _reg_set ${ID} lastswap ${nowS() + 5}`);
    expect(target()).toBe('');
  });

  it('a home chosen before the mark is held by it', () => {
    setup();
    h.sh(`cmd_prefer ${ID} claude`); at(`${ID}.home`, -600);
    expect(target()).toBe('');
  });
});

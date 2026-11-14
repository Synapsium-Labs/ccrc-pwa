// The PreCompact refusal arm, dark (Overlord W1a compaction, Task 4; spec §3.3.4 C39; W0-13; rulings R7a, R7b, R11).
// `_hook_compact_refuse` is a verdict of its own, dispatched after `_hook_compact_pre` and ahead of `_hook_history_pre`,
// so no history switch turns it off. It refuses, once a turn, a main-thread automatic compaction whose scope rule answers
// `main`, only while the route field `precompact` reads `refuse`; refusing, it prints PreCompact's JSON block decision
// and sets CS_REFUSED, so history's print stays silent and the events line says `"phase":"refused"` in place of `"pre"`.
// "This turn" starts at the turn marker's existing `turnAt` (ruling on review 1902 n2): a refused line at or after it is
// this turn's, and a marker that cannot be read answers "refused already".
//
// Runs ccd/session-hook.sh for real inside a fixture HOME (the harness of session-hook-precompact.test.ts, copied: a test
// file cannot import another). The parity table is `sim/compactionSets.ts`'s, run here through the bash arm and in
// `continuity-precompact.test.ts` through `precompactDecision`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { PRECOMPACT_PARITY, type PrecompactRow } from './sim/compactionSets.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
/** The block decision the arm prints, exactly. */
const BLOCK = '{"decision":"block","reason":"ccrc: this automatic compaction is refused once this turn, and a renewal is due (Overlord C39)"}\n';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-refuse-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (f: string): string => path.join(home, '.cc-sessions', f);
const linesOf = (p: string): Array<Record<string, unknown>> => fs.existsSync(p)
  ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
  : [];
const events = (): Array<Record<string, unknown>> => linesOf(reg(`${ID}.compactevents`));
const phases = (): unknown[] => events().map((l) => l['phase']);

const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION, CS_REFUSED: '', CLAUDECODE: '', ...over,
});
/** One hook run: the spawn did not fail, exit 0, silent stderr; answers stdout. */
const run = (payload: object, over: NodeJS.ProcessEnv = {}): string => {
  const r = spawnSyncGroup('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: env(over), timeout: 30_000 });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook is silent on stderr').toBe('');
  return r.stdout;
};

/** A main transcript, old enough that its own liveness never decides; `agents` live subagent files beside it. */
const transcript = (agents = 0): string => {
  const proj = path.join(home, '.claude', 'projects', '-rig-repo');
  fs.mkdirSync(proj, { recursive: true });
  const t = path.join(proj, `${UUID}.jsonl`);
  fs.writeFileSync(t, '{"type":"user"}\n');
  const old = Math.floor(Date.now() / 1000) - 600;
  fs.utimesSync(t, old, old);
  if (agents > 0) {
    const dir = path.join(proj, UUID, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < agents; i += 1) fs.writeFileSync(path.join(dir, `agent-a${i}.jsonl`), '{"type":"user"}\n');
  }
  return t;
};
const preCompact = (trigger: string | null, transcriptPath: string, sid = UUID): object => ({
  session_id: sid, transcript_path: transcriptPath, cwd: path.join(home, 'repo'), hook_event_name: 'PreCompact',
  ...(trigger === null ? {} : { trigger }), custom_instructions: null,
});
const field = (v: string | null): void => {
  if (v === null) fs.rmSync(reg(`${ID}.precompact`), { force: true }); else fs.writeFileSync(reg(`${ID}.precompact`), `${v}\n`);
};
/** The turn marker as `_hook_turn_mark` writes it on `working`: `turnAt` is the turn's start. */
const turn = (turnAt: number | null, sessionId = UUID): void => {
  fs.writeFileSync(reg(`${ID}.turn.json`), `${JSON.stringify({ v: 1, sessionId, state: 'working', event: 'UserPromptSubmit', at: turnAt ?? Date.now(), turnAt, stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: -1 })}\n`);
};
/** The armed fixture: the route says refuse and this turn began a minute ago. */
const armed = (): string => { field('refuse'); turn(Date.now() - 60_000); return transcript(); };

describe('dark: with the route field absent, nothing is refused', () => {
  it('an automatic main-scope compaction with no precompact field passes and records pre', () => {
    turn(Date.now() - 60_000);
    expect(run(preCompact('auto', transcript()))).toBe('');
    expect(phases()).toEqual(['pre']);
  });
  it('allow passes, and so does a word the field does not take', () => {
    const t = armed();
    for (const v of ['allow', 'refusex', 'REFUSE', '']) {
      field(v);
      expect(run(preCompact('auto', t)), v).toBe('');
    }
    expect(phases()).toEqual(['pre', 'pre', 'pre', 'pre']);
  });
  it('a linked precompact field is not read', () => {
    const t = armed();
    fs.rmSync(reg(`${ID}.precompact`));
    fs.writeFileSync(path.join(home, 'pc'), 'refuse\n');
    fs.symlinkSync(path.join(home, 'pc'), reg(`${ID}.precompact`));
    expect(run(preCompact('auto', t))).toBe('');
  });
});

describe('armed: refuse + auto + main scope is blocked once a turn', () => {
  it('blocked: the block decision is the whole stdout, one refused line and no pre line, the PostCompact journal untouched', () => {
    const t = armed();
    expect(run(preCompact('auto', t))).toBe(BLOCK);
    expect(events()).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: 'main', transcript: t, phase: 'refused' }]);
    expect(fs.existsSync(reg(`${ID}.compactions`)), 'the PostCompact journal takes no line').toBe(false);
  });
  it('the same turn\'s second PreCompact passes and records pre; the next turn\'s first is refused again', () => {
    const t = armed();
    expect(run(preCompact('auto', t))).toBe(BLOCK);
    expect(run(preCompact('auto', t))).toBe('');
    expect(phases()).toEqual(['refused', 'pre']);
    turn(Date.now() + 1);                                   // a new UserPromptSubmit: a new turn starts after the refusal
    expect(run(preCompact('auto', t))).toBe(BLOCK);
    expect(phases()).toEqual(['refused', 'pre', 'refused']);
  });
  it('a refusal in .compacteventsprev counts for this turn too', () => {
    const t = armed();
    fs.writeFileSync(reg(`${ID}.compacteventsprev`), `${JSON.stringify({ at: Date.now() - 1000, trigger: 'auto', scope: 'main', transcript: t, phase: 'refused' })}\n`);
    expect(run(preCompact('auto', t))).toBe('');
    expect(phases()).toEqual(['pre']);
  });
  it('a refused line from before this turn\'s start is not this turn\'s', () => {
    const t = armed();
    fs.writeFileSync(reg(`${ID}.compactevents`), `${JSON.stringify({ at: Date.now() - 120_000, trigger: 'auto', scope: 'main', transcript: t, phase: 'refused' })}\n`);
    expect(run(preCompact('auto', t))).toBe(BLOCK);
  });
  it('a turn marker that cannot be read, is another session\'s or has no turnAt lets the compaction through', () => {
    const t = armed();
    const shapes: Array<[string, () => void]> = [
      ['absent', () => { fs.rmSync(reg(`${ID}.turn.json`), { force: true }); }],
      ['a directory', () => { fs.rmSync(reg(`${ID}.turn.json`), { force: true }); fs.mkdirSync(reg(`${ID}.turn.json`)); }],
      ['malformed', () => { fs.rmSync(reg(`${ID}.turn.json`), { recursive: true, force: true }); fs.writeFileSync(reg(`${ID}.turn.json`), '{not json\n'); }],
      ['another session\'s', () => { fs.rmSync(reg(`${ID}.turn.json`), { recursive: true, force: true }); turn(Date.now() - 60_000, '00000000-0000-4000-8000-0000000000ff'); }],
      ['turnAt null', () => { turn(null); }],
      ['a link', () => { fs.rmSync(reg(`${ID}.turn.json`), { force: true }); turn(Date.now() - 60_000); fs.renameSync(reg(`${ID}.turn.json`), path.join(home, 'tm')); fs.symlinkSync(path.join(home, 'tm'), reg(`${ID}.turn.json`)); }],
    ];
    for (const [name, plant] of shapes) {
      plant();
      expect(run(preCompact('auto', t)), name).toBe('');
    }
    expect(phases().every((p) => p === 'pre')).toBe(true);
  });
  it('a manual compaction is never refused', () => {
    const t = armed();
    expect(run(preCompact('manual', t))).toBe('');
    expect(phases()).toEqual(['pre']);
  });
  it('a subagent or an ambiguous scope is never refused, and records pre with its scope (R7a)', () => {
    field('refuse'); turn(Date.now() - 60_000);
    expect(run(preCompact('auto', transcript(1)))).toBe('');
    expect(run(preCompact('auto', transcript(2)))).toBe('');
    expect(events().map((l) => [l['phase'], l['scope']])).toEqual([['pre', 'subagent'], ['pre', 'ambiguous']]);
  });
  it('a subagent\'s own PreCompact (a payload with an agent id) is never refused', () => {
    const t = armed();
    expect(run({ ...preCompact('auto', t), agent_id: 'a1' })).toBe('');
  });
  it('a print that fails refuses nothing: the line says pre', () => {
    const t = armed();
    const r = spawnSyncGroup('bash', ['-c', 'bash "$0" >&-; echo "rc=$?"', HOOK], { input: JSON.stringify(preCompact('auto', t)), encoding: 'utf8', env: env(), timeout: 30_000 });
    expect(r.error).toBeUndefined();
    expect([r.stdout, r.stderr]).toEqual(['rc=0\n', '']);
    expect(phases()).toEqual(['pre']);
  });
});

describe('no history switch turns the arm off (R7b)', () => {
  const ccrc = (...p: string[]): string => path.join(home, '.ccrc', ...p);
  it('with history-off, with history-steer-off, with steer-on absent and with a session id that is no UUID, the refusal still fires', () => {
    const t = armed();
    fs.mkdirSync(ccrc(), { recursive: true });
    fs.writeFileSync(ccrc('history-off'), '');
    expect(run(preCompact('auto', t)), 'history-off').toBe(BLOCK);
    fs.rmSync(ccrc('history-off'));
    fs.writeFileSync(ccrc('history-steer-off'), '');
    turn(Date.now() + 1);
    expect(run(preCompact('auto', t)), 'history-steer-off').toBe(BLOCK);
    fs.rmSync(ccrc('history-steer-off'));
    turn(Date.now() + 2);
    expect(run(preCompact('auto', t, 'not-a-uuid')), 'a bad psid').toBe(BLOCK);
    expect(phases()).toEqual(['refused', 'refused', 'refused']);
  });
  it('armed for history\'s steer print, a refused event prints only its block; an allowed one prints the steer', () => {
    const t = armed();
    fs.mkdirSync(ccrc('history', 'steer-on'), { recursive: true });
    fs.writeFileSync(ccrc('history', 'steer-on', ID), '');
    expect(run(preCompact('auto', t))).toBe(BLOCK);
    field('allow');
    const out = run(preCompact('auto', t));
    expect(out.startsWith('\nccrc history archive entry.'), 'CONTROL: the steer print fires when nothing is refused').toBe(true);
  });
});

// The coordinator's ruling on the order (departure refusal-ahead-of-the-card): the arm runs before the card, and the card
// returns at once on CS_REFUSED. A refused event is no compaction and has no PostCompact, so a card set written for it
// would stand unconsumed, and for twenty minutes the card would read the next real compaction as an overlap: scope
// `ambiguous`, its card degraded, and history's steer print (main only) silent for it.
describe('a refused event writes nothing of the card\'s (refusal-ahead-of-the-card)', () => {
  const HELPER_SRC = path.resolve(__dirname, '../../ccd/compact-card.mjs');
  const set = (): Record<string, unknown> | null =>
    fs.existsSync(reg(`${ID}.compactset`)) ? JSON.parse(fs.readFileSync(reg(`${ID}.compactset`), 'utf8').split('\n')[0]!) as Record<string, unknown> : null;
  it('a refused PreCompact writes no compactset; the next allowed one, inside twenty minutes, is main with no overlap and gets the steer print', () => {
    fs.copyFileSync(HELPER_SRC, reg('compact-card.mjs'));
    fs.mkdirSync(path.join(home, 'repo'), { recursive: true });
    fs.mkdirSync(path.join(home, '.ccrc', 'history', 'steer-on'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'history', 'steer-on', ID), '');
    const t = armed();
    expect(run(preCompact('auto', t))).toBe(BLOCK);
    expect(fs.existsSync(reg(`${ID}.compactset`)), 'the refused event wrote no card set').toBe(false);
    expect(fs.existsSync(reg(`${ID}.compactcard`)), 'nor a card').toBe(false);
    const out = run(preCompact('auto', t));                // the same turn: the soft budget lets this one through
    expect(out.startsWith('\nccrc history archive entry.'), 'the allowed compaction gets the steer print').toBe(true);
    expect(set(), 'the allowed compaction\'s card set').toMatchObject({ scope: 'main', overlap: false });
    expect(events().map((l) => [l['phase'], l['scope']])).toEqual([['refused', 'main'], ['pre', 'main']]);
  });
  it('CONTROL: the card writes its set for an allowed PreCompact', () => {
    fs.copyFileSync(HELPER_SRC, reg('compact-card.mjs'));
    fs.mkdirSync(path.join(home, 'repo'), { recursive: true });
    turn(Date.now() - 60_000);
    expect(run(preCompact('auto', transcript()))).toBe('');
    expect(set()).toMatchObject({ scope: 'main', overlap: false });
  });
});

describe('parity: the bash arm and precompactDecision agree on every row of the table', () => {
  const plant = (r: PrecompactRow): string => {
    field(r.field);
    turn(Date.now() - 60_000);
    if (r.refused) fs.writeFileSync(reg(`${ID}.compactevents`), `${JSON.stringify({ at: Date.now() - 1000, trigger: 'auto', scope: 'main', transcript: null, phase: 'refused' })}\n`);
    else fs.rmSync(reg(`${ID}.compactevents`), { force: true });
    if (r.scope === null) return path.join(home, 'absent', 'transcript.jsonl');
    return transcript(r.scope === 'subagent' ? 1 : r.scope === 'ambiguous' ? 2 : 0);
  };
  for (const r of PRECOMPACT_PARITY) {
    it(JSON.stringify(r), () => {
      if (r.trigger === 'manual' && r.scope !== 'main') throw new Error('the scope rule answers main for every manual trigger');
      const t = plant(r);
      expect(run(preCompact(r.trigger, t)) === BLOCK ? 'refuse' : 'pass').toBe(r.verdict);
      fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
    });
  }
});

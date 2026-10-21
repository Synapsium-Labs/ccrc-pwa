// Every silent stand-down logged, once per episode, with a re-log floor
// (D-6180; auto-swap reliability spec §3.2, the operator's D5 ruling).
//
// `_auto_swap_check` holds a session in a dozen places and, before D-6180, said
// so in almost none of them (spec §2.5's table). This file pins what each of
// those places writes to `swap.log`. It changes no decision: every row that
// asserts a line also asserts the move (or the absence of one) is what it was.
//
// THE CHARACTERIZATION BLOCK comes first and was green on the base: "today:"
// rows are the ones D-6180's commits flip (each flipped row is rewritten in
// the commit that flips it and keeps its name, so the name records the base and
// the body the flipped answer), "kept:" rows must never move.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from
// `$HOME/pane.txt` and, while `TMUX_CREATED` is set, the pane's
// `session_created`; `_dispatch_swap` logs; `_swap_target` and `_avail` are
// stubbed where a case is about the stand-down rather than the choice. The
// clock is ccd's own seam (`_now_s_to` falls back to `date +%s` when `date` is
// a function), driven by `FAKE_NOW`. Neutral ids throughout (public
// repository): the session `lane-a-project-a`, the fixture roster's wrappers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-standdown-notes-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000d5';
const PID = '4242';
const T0 = Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (wrapper = 'claude', home = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home ${home}
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
};

/** Claude Code's 429 row (the `ccd-rescue-policy.test.ts` shape). */
const limitRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  quotaLimits: { status: 'rejected', resetsAt: at + 3600, rateLimitType: 'five_hour' },
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};

const BORDER = '────────────────────────────';
const PROMPT = '? for shortcuts\n❯ ';
const STALLED = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
const BUSY = '✻ Working… (12s · esc to interrupt)\n❯ ';
const DRAFT = `${BORDER}\n❯ a half-typed reply\n${BORDER}\n  ? for shortcuts`;

/** tmux answers ONE pane for every capture; `narrow` in HOME makes the width
 *  query fail. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && { echo "1 80"; return 0; }; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };`;
};
/** The pane's process was born a day before T0 unless a case says not. */
const env = (now = T0, born = T0 - 86400): Record<string, string> => ({ TMUX_CREATED: String(born), FAKE_NOW: String(now) });
const tick = (pane: string, opts: { target?: string | null; now?: number; born?: number; extra?: string } = {}): void => {
  h.sh(`${STUBS(pane, opts.target === undefined ? 'claude-a' : opts.target)} ${opts.extra ?? ''} _auto_swap_check ${ID}`,
    env(opts.now, opts.born));
};
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));

/** The affinity arm, every gate open: a clean prompt, an idle status file far
 *  older than SWAP_CEIL_QUIET, a target other than cur, `_avail` passing. */
const idleStatus = (wrapper = 'claude'): void => {
  const dir = path.join(h.home, wrapper === 'claude' ? '.claude' : `.${wrapper}`, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};
const AFFINITY = '_avail() { return 0; };';

// ── CHARACTERIZATION ─────────────────────────────────────────────────────────

describe('characterization: what each silent exit writes today', () => {
  it('today: a session in SWAP_COOLDOWN whose newest transcript row is this process\'s limit row writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    // flipped by D-6180's call sites: one stand-down line, and still no move
    expect(swapLog().split('\n').filter(Boolean)).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: cooldown evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('today: the same in SWAPBLOCK_COOLDOWN writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} swapblocked "${T0 - 100} refused"`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    // flipped by D-6180's call sites
    expect(swapLog().split('\n').filter(Boolean)).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: swapblocked evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('today: a draft stand-down over a limit row writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(DRAFT, { target: '' });
    // flipped by D-6180's call sites
    expect(swapLog().split('\n').filter(Boolean)).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: draft evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('today: a carried-in transcript row caches as 0 and reads negative', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    const out = h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?|$HARD_BLOCK_NO"`, env(T0, T0 - 1900));
    expect(out).toBe('1|carried-in');   // flipped by D-6180's carried-in word; the cached value is still 0
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 0`);
  });

  it('today: the rescue\'s dropped target writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: '_avail() { return 1; };' });
    // flipped by D-6180's call sites
    expect(swapLog().split('\n').filter(Boolean)).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: target-unavailable evidence=(pane|banner) banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('today: an affinity move held by .hold writes nothing', () => {
    seed(); idleStatus(); writeTranscript([turn(T0 - 60)]);
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:1/1 run:1');
    tick(PROMPT, { extra: AFFINITY });
    // flipped by D-6180's call sites
    expect(swapLog().split('\n').filter(Boolean)).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: hold$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('today: an auto-rescue line ends at its [home=…]/via= suffix', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: AFFINITY });
    // flipped by D-6180's lane= word: the line now ends one word later
    expect(swapLog()).toMatch(/auto-rescue lane-a-project-a: claude \(blocked\) -> claude-a \[home=claude\]( via=\S+)?( reset=\S+)?( type=\S+)?( row=\S+)? lane=anthropic$/m);
  });

  it('kept: a session in cooldown with no limit row writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60)]);
    tick(PROMPT);
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('kept: the rescue dispatches on the same tick it detects', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: AFFINITY });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(lines('auto-rescue')).toHaveLength(1);
  });

  it('kept: pin-hold\'s floored note is unchanged', () => {
    seed('claude-a', 'claude'); idleStatus('claude-a'); writeTranscript([turn(T0 - 60)]);
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick(PROMPT, { target: 'claude', extra: AFFINITY });
    tick(PROMPT, { target: 'claude', extra: AFFINITY, now: T0 + 60 });
    expect(lines('pin-hold')).toEqual([
      expect.stringMatching(/pin-hold lane-a-project-a: pinned to claude-a by hand; the return-home\/ceiling arm stands down \(a limit still evacuates\)$/),
    ]);
    expect(dispatches()).toEqual([]);
  });

  it('kept: _pane_narrow_note writes at most once per floor', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    fs.writeFileSync(path.join(h.home, 'narrow'), '');
    tick(PROMPT);
    tick(PROMPT, { now: T0 + 600 });
    expect(lines('swap-skip')).toHaveLength(1);
    expect(lines('swap-skip')[0]).toMatch(/swap-skip lane-a-project-a: pane is under \d+ columns/);
    expect(dispatches()).toEqual([]);
  });

  it('kept: a busy session at home writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(BUSY, { target: '' });
    expect(swapLog()).toBe('');
  });
});

// ── D-6180: THE STAND-DOWN LINES ─────────────────────────────────────────────

/** Many ticks in ONE shell (the supervisor's own shape: globals and the
 *  registry carry between ticks), `step` seconds apart from `from`. */
const ticks = (pane: string, n: number, opts: { from?: number; step?: number; target?: string | null; extra?: string; born?: number } = {}): void => {
  const from = opts.from ?? T0; const step = opts.step ?? 5;
  h.sh(`${STUBS(pane, opts.target === undefined ? 'claude-a' : opts.target)} ${opts.extra ?? ''}
    for ((i = 0; i < ${n}; i++)); do FAKE_NOW=$(( ${from} + i * ${step} )); _auto_swap_check ${ID}; done`, env(from, opts.born));
};
/** The evidence probe's own fork: `_pane_born` asks tmux for the session's birth,
 *  and no other step of a cooldown tick does. */
const probes = (): number => h.calls().filter((l) => l.includes('display-message')).length;
const standDowns = (): string[] => lines('stand-down');

describe('D-6180: every silent stand-down logged, once per episode, with a re-log floor', () => {
  it('a cooldown over a limit row writes one stand-down line', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    expect(standDowns()).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: cooldown evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('a second tick in the same episode writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    tick(PROMPT, { now: T0 + 5 });
    expect(standDowns()).toHaveLength(1);
  });

  it('fifteen cooldown ticks over one limit row write one line', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    ticks(PROMPT, 15, { step: 60 });
    expect(standDowns()).toHaveLength(1);
    expect(dispatches()).toEqual([]);
  });

  it('180 consecutive SWAP_COOLDOWN ticks over a limit row write exactly one stand-down line and probe at most once per TRANSCRIPT_ARM_INTERVAL', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    const interval = Number(h.sh('echo "$TRANSCRIPT_ARM_INTERVAL"'));
    ticks(PROMPT, 180, { step: 5 });
    expect(standDowns()).toHaveLength(1);
    expect(probes()).toBeGreaterThan(0);
    expect(probes()).toBeLessThanOrEqual(Math.ceil((180 * 5) / interval));
    expect(dispatches()).toEqual([]);
  });

  it('the same with no limit row: no line, and the none answer is cached', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    writeTranscript([turn(T0 - 60)]);
    ticks(PROMPT, 12, { step: 5 });
    expect(standDowns()).toEqual([]);
    expect(probes(), 'one probe at T0, one at T0+30').toBe(2);
    expect(h.reg(ID, 'standdownprobe')).toBe(`${T0 + 30} none`);
  });

  it('a limit row that appears 5 minutes into SWAP_COOLDOWN is logged within TRANSCRIPT_ARM_INTERVAL', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    const tx = writeTranscript([turn(T0 - 60)]);
    ticks(PROMPT, 60, { step: 5 });   // T0 .. T0+295
    expect(standDowns()).toEqual([]);
    fs.appendFileSync(tx, `${limitRow(T0 + 297)}\n`);
    ticks(PROMPT, 7, { from: T0 + 300, step: 5 });   // T0+300 .. T0+330
    expect(standDowns()).toEqual([expect.stringMatching(/: cooldown evidence=transcript /)]);
  });

  it('the probe writes no carried-in line', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([limitRow(T0 - 3000)]);
    tick(PROMPT, { born: T0 - 1900 });
    expect(h.reg(ID, 'standdownprobe')).toBe(`${T0} carried-in`);
    expect(lines('carried-in')).toEqual([]);
    expect(standDowns(), 'only transcript evidence counts at the cooldown').toEqual([]);
  });

  it('the episode is re-logged after the floor', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    const floor = Number(h.sh('echo "$COMPACT_NOTE_FLOOR"'));
    tick(DRAFT, { target: '' });
    tick(DRAFT, { target: '', now: T0 + 60 });
    expect(standDowns()).toHaveLength(1);
    tick(DRAFT, { target: '', now: T0 + floor });
    expect(standDowns()).toHaveLength(2);
    expect(dispatches()).toEqual([]);
  });

  it('a dispatch or a new reason word ends the episode', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(DRAFT, { target: '' });
    h.sh(`_reg_set ${ID} lastswap ${T0 + 10}`);
    tick(PROMPT, { now: T0 + 20 });
    h.sh(`rm -f "$REG/${ID}.lastswap"`);
    tick(DRAFT, { target: '', now: T0 + 30 });
    expect(standDowns().map((l) => l.replace(/^.* stand-down \S+ /, ''))).toEqual([
      'draft evidence=transcript banner-outside-tail=no',
      'cooldown evidence=transcript banner-outside-tail=no',
      'draft evidence=transcript banner-outside-tail=no',
    ]);
    tick(STALLED, { extra: AFFINITY, now: T0 + 40 });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(h.reg(ID, 'standdown'), 'the dispatch ended the episode').toBeNull();
  });

  it('a cooldown with no limit evidence writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60)]);
    tick(PROMPT);
    expect(h.reg(ID, 'standdownprobe'), 'the probe ran and answered none').toBe(`${T0} none`);
    expect(swapLog()).toBe('');
  });

  it('draft over a limit row is logged with evidence=transcript', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(DRAFT, { target: '' });
    expect(standDowns()).toEqual([expect.stringMatching(/ stand-down lane-a-project-a: draft evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('a carried-in transcript row reads carried-in, not negative', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    const out = h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?|$HARD_BLOCK_NO"`, env(T0, T0 - 1900));
    expect(out).toBe('1|carried-in');
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 0`);
  });

  it('the cached verdict is reused unchanged', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    const call = (now: number): string => h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?|$HARD_BLOCK_NO"`, env(now, T0 - 1900));
    expect(call(T0)).toBe('1|carried-in');
    expect(call(T0 + 10), 'the cached 0 answers as any cached no').toBe('1|negative');
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 0`);
  });

  it('target-unavailable is logged when hard-blocked', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: '_avail() { return 1; };' });
    expect(standDowns()).toEqual([expect.stringMatching(/: target-unavailable evidence=(pane|banner) banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('target-unavailable on the affinity path is logged only when ccd had a target other than cur', () => {
    seed(); idleStatus(); writeTranscript([turn(T0 - 60)]);
    tick(PROMPT, { target: 'claude', extra: '_avail() { return 1; };' });
    expect(standDowns(), 'no target other than cur: nothing').toEqual([]);
    tick(PROMPT, { now: T0 + 5, extra: '_avail() { return 1; };' });
    expect(standDowns()).toEqual([expect.stringMatching(/: target-unavailable$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('an affinity move held by .hold is logged only when ccd had a target', () => {
    seed(); idleStatus(); writeTranscript([turn(T0 - 60)]);
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:1/1 run:1');
    tick(PROMPT, { target: '', extra: AFFINITY });
    expect(standDowns()).toEqual([]);
    tick(PROMPT, { now: T0 + 5, extra: AFFINITY });
    expect(standDowns()).toEqual([expect.stringMatching(/: hold$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('negative writes no line', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(PROMPT, { target: '' });
    tick(PROMPT, { target: '', now: T0 + 60 });
    expect(swapLog()).toBe('');
    expect(h.reg(ID, 'standdownprobe'), 'and the steady tick never probes').toBeNull();
  });

  it('tick-undecidable re-logs the same field after the floor', () => {
    seed();
    const floor = Number(h.sh('echo "$COMPACT_NOTE_FLOOR"'));
    const say = (now: number): void => { h.sh(`${STUBS(PROMPT)} _tick_undecidable ${ID} pool`, env(now)); };
    say(T0); say(T0 + 60);
    expect(lines('tick-undecidable')).toHaveLength(1);
    say(T0 + floor);
    expect(lines('tick-undecidable')).toEqual([
      expect.stringMatching(/tick-undecidable lane-a-project-a: pool could not be measured — deciding nothing$/),
      expect.stringMatching(/tick-undecidable lane-a-project-a: pool could not be measured — deciding nothing \(still, 30m\)$/),
    ]);
    say(T0 + floor + 60);
    expect(lines('tick-undecidable'), 'the stamp was refreshed').toHaveLength(2);
  });

  it('banner-outside-tail is yes when only the whole pane shows the banner', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    const dialog = ["You've hit your session limit · resets 9:10pm (UTC)", ...Array.from({ length: 10 }, (_, i) => `  ${i + 1}. an option`), PROMPT].join('\n');
    tick(dialog);
    expect(standDowns()).toEqual([expect.stringMatching(/: cooldown evidence=transcript banner-outside-tail=yes$/)]);
  });

  it('auto-rescue and auto-home lines carry lane=', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: `${AFFINITY} CCRC_ANTHROPIC_BACKEND=(claude);` });
    expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ -> claude-a \[home=claude\].* lane=other$/)]);
    const h2 = h; h = makeCcdHarness('ccrc-ccd-standdown-notes-');
    try {
      seed(); idleStatus(); writeTranscript([turn(T0 - 60)]);
      tick(PROMPT, { extra: AFFINITY });
      expect(lines('auto-home')).toEqual([expect.stringMatching(/auto-home lane-a-project-a: claude -> claude-a \[home=claude\] lane=anthropic$/)]);
    } finally { h.cleanup(); h = h2; }
  });

  it('the rescue still dispatches on the tick it detects, with no line before it', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(STALLED, { extra: AFFINITY });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(swapLog().split('\n').filter(Boolean).map((l) => l.split(' ')[2])).toEqual(['auto-rescue']);
    expect(h.reg(ID, 'standdownprobe'), 'no probe on the rescue path').toBeNull();
  });
});

// ── ONE EPISODE PER ARM (review round 1, finding 1) ─────────────────────────
// A tick that is not hard-blocked can say a limit-arm word (carried-in, draft,
// stalepress, running) and then pass `_rescue_policy` into the affinity arm and
// say an affinity word (hold, woke, idle-gate, target-unavailable). On one shared
// field the two words ended each other's episode every tick: two lines per tick,
// a `capture-pane` each, and a swap.log that pushes rule 3's real rescue lines
// out of its 1 MiB tail. Each arm keeps its own field (departure
// `standdown-per-arm`); every row below wrote 2 lines PER TICK before it.
describe('D-6180: one episode per arm, so two arms on one tick do not flood', () => {
  const HOLD = (): void => { fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:1/1 run:1'); };
  /** A carried-in pane banner: the limit row predates this process and a swap followed it. */
  const carriedIn = (): void => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
  };
  const words = (): string[] => standDowns().map((l) => l.replace(/^.* stand-down \S+ /, '').split(' ')[0]);

  it('a draft over a limit row under .hold writes exactly two lines over 12 ticks', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]); HOLD();
    ticks(DRAFT, 12, { step: 5 });
    expect(words()).toEqual(['draft', 'hold']);
    expect(dispatches()).toEqual([]);
  });

  it('a carried-in pane banner under .hold writes exactly two lines over 12 ticks', () => {
    carriedIn(); HOLD();
    ticks(STALLED, 12, { step: 5, born: T0 - 1900 });
    expect(words()).toEqual(['carried-in', 'hold']);
    expect(dispatches()).toEqual([]);
  });

  it('a carried-in pane banner with the target unavailable writes exactly two lines over 12 ticks', () => {
    carriedIn();
    ticks(STALLED, 12, { step: 5, born: T0 - 1900, extra: '_avail() { return 1; };' });
    expect(words()).toEqual(['carried-in', 'target-unavailable']);
    expect(dispatches()).toEqual([]);
  });

  it('a carried-in pane banner inside the .woke cooldown writes exactly two lines over 12 ticks', () => {
    carriedIn(); fs.writeFileSync(regFile(`${ID}.woke`), `${T0 - 10}\n`);
    ticks(STALLED, 12, { step: 5, born: T0 - 1900, extra: AFFINITY });
    expect(words()).toEqual(['carried-in', 'woke']);
    expect(dispatches()).toEqual([]);
  });

  it('360 ticks of both arms stay at or below 2 × ceil(duration / COMPACT_NOTE_FLOOR) lines', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]); HOLD();
    const floor = Number(h.sh('echo "$COMPACT_NOTE_FLOOR"'));
    ticks(DRAFT, 360, { step: 5 });
    expect(standDowns().length).toBeLessThanOrEqual(2 * Math.ceil((360 * 5) / floor));
    expect(dispatches()).toEqual([]);
  }, 120_000);   // 360 real bash ticks: ~16 s on a laptop, past CI's 20 s default on a loaded runner

  it('a dispatch ends both arms\' episodes', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]); HOLD();
    tick(DRAFT);
    expect(h.reg(ID, 'standdown')).toBe(`${T0} draft`);
    expect(h.reg(ID, 'standdownaff')).toBe(`${T0} hold`);
    fs.rmSync(regFile(`${ID}.hold`));
    tick(STALLED, { extra: AFFINITY, now: T0 + 10 });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(h.reg(ID, 'standdown')).toBeNull();
    expect(h.reg(ID, 'standdownaff')).toBeNull();
  });

  // Review round 1, finding 2: `_limit_dated` turns rc 3 into a block when no
  // swap followed the row; the probe answers as it does, so a cooldown over
  // that kept block is said with evidence=transcript.
  it('a cooldown over a carried-in row no swap followed is said as transcript', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 300}`);
    writeTranscript([limitRow(T0 - 200)]);
    tick(PROMPT, { born: T0 - 50 });
    expect(h.reg(ID, 'standdownprobe')).toBe(`${T0} transcript`);
    expect(standDowns()).toEqual([expect.stringMatching(/: cooldown evidence=transcript banner-outside-tail=no$/)]);
    expect(dispatches()).toEqual([]);
  });

  it('the same row with a swap after it stays carried-in, and the cooldown says nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([limitRow(T0 - 200)]);
    tick(PROMPT, { born: T0 - 50 });
    expect(h.reg(ID, 'standdownprobe')).toBe(`${T0} carried-in`);
    expect(standDowns()).toEqual([]);
  });
});

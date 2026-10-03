// `deploy/measure-continuity.py`'s stage-4 rows (session-continuity spec §9;
// wave 2). The instrument is READ-ONLY and stage 4 reads swap.log (and, for a
// no-room wait still open now, that session's `.rescuewait` record), so two
// things are pinned: each row counts what its name says on a hand-built log
// whose answer is known, and each regex it parses is bound to a line the REAL
// ccd function wrote — a reworded ccd line reds here, not silently on the
// fleet. The CLI is the programme's shared one (`--stage N`, `--home`,
// `--swap-log`, `--since`, `--until`, `--json`), whichever wave wrote it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-'); });
afterEach(() => { h.cleanup(); });

type Rescue = Record<string, number | string | Record<string, number>>;
/** `--home <home> --stage 4 [extra] --json`, answering stage 4's `rescue` section. */
const run = (home: string, extra: string[] = [], env: Record<string, string> = {}): Rescue => {
  const out = execFileSync('python3', [TOOL, '--home', home, '--stage', '4', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage4: { rescue: Rescue } }).stage4.rescue;
};
const utc = (s: string): number => Math.floor(Date.parse(`${s.replace(' ', 'T')}Z`) / 1000);
const carriedIn = (at: string, sid: string, via: string): string =>
  `2026-09-20 ${at} carried-in ${sid}: via=${via} rate-limit row at 1 predates this pane's process (born 2) — not a block [wrapper=claude] [spawn=0]`;

describe('stage 4 rows count what their names say (TZ=UTC, hand-built log)', () => {
  const lines = [
    // s1 landed at 10:00; its 10:30 rescue fired on a row from 09:50 (carried in), its 10:40 one on a row from 10:35.
    '2026-09-20 09:00:00 swap s1: claude-d -> claude (uuid u0)',   // an EARLIER landing: the rule compares with the newest
    '2026-09-20 10:00:00 swap s1: claude -> claude-a (uuid u1)',
    `2026-09-20 10:30:00 auto-rescue s1: claude-a (blocked) -> claude-b [home=claude] via=transcript reset=${utc('2026-09-20 12:00:00')} type=five_hour row=${utc('2026-09-20 09:50:00')}`,
    `2026-09-20 10:40:00 auto-rescue s1: claude-b (blocked) -> claude-d [home=claude] via=banner row=${utc('2026-09-20 10:35:00')}`,
    // s2: four rescues inside one hour, no dated row.
    ...['10:00', '10:15', '10:30', '10:59'].map((m) => `2026-09-20 ${m}:00 auto-rescue s2: claude (blocked) -> claude-a [home=claude]`),
    // rule 1 (D-3526): pane suppressions that became a rescue within 5 minutes — s3 (pane, 3 min) and
    // s17 (banner, 4 min) — one that took 8 (s19, pane), and transcript ones, which §9's row does not
    // name: s4 (10 min) and s16 (2 min).
    carriedIn('11:00:00', 's3', 'pane'),
    '2026-09-20 11:03:00 auto-rescue s3: claude (blocked) -> claude-a [home=claude]',
    carriedIn('11:00:00', 's4', 'transcript'),
    '2026-09-20 11:10:00 auto-rescue s4: claude (blocked) -> claude-a [home=claude]',
    carriedIn('11:20:00', 's16', 'transcript'),
    '2026-09-20 11:22:00 auto-rescue s16: claude (blocked) -> claude-a [home=claude] via=transcript',
    carriedIn('11:30:00', 's17', 'banner'),
    '2026-09-20 11:34:00 auto-rescue s17: claude (blocked) -> claude-a [home=claude] via=banner',
    carriedIn('11:40:00', 's19', 'pane'),
    '2026-09-20 11:48:00 auto-rescue s19: claude (blocked) -> claude-a [home=claude]',
    // waits: a near wait ending in a swap; four chain waits, ending clear BEFORE its reset (neither),
    // turned (a reset), noroom (neither), and near (handed to rule 2's wait on its own reset).
    '2026-09-20 12:00:00 rescuewait s5: kind=near on claude reset=1',
    '2026-09-20 12:05:00 rescuewait-end s5: kind=near on claude reset=1 after 300s end=swap',
    `2026-09-20 12:10:00 rescuewait-end s6: kind=chain on claude reset=${utc('2026-09-20 13:00:00')} after 60s end=clear`,
    '2026-09-20 12:10:00 rescuewait-end s7: kind=chain on claude reset=1 after 60s end=turned',
    '2026-09-20 12:10:00 rescuewait-end s8: kind=chain on claude reset=- after 1800s end=noroom',
    `2026-09-20 12:10:00 rescuewait-end s18: kind=chain on claude reset=${utc('2026-09-20 12:15:00')} after 60s end=near`,
    // §11 item 6 (stalled, own account the only one with room): no-room waits against a 13:30 reset.
    // s9 idled 30 minutes past it and then swapped (counted); s10's armed pane ended it in place
    // (`turned`, not counted); s11 swapped inside the grace (not counted); s12 had no reset (not
    // counted); s13 is still open, against a 13:10 reset (counted, measured to the window's end);
    // s14's session was purged mid-wait, so no end line exists and the registry holds no record
    // (not counted when measuring now — the registry, not the log, says a wait is open now); s15's
    // record was re-used by a later session of the same id and is closed (not counted either).
    `2026-09-20 13:00:00 rescuewait s9: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')}`,
    `2026-09-20 13:00:00 rescuewait s10: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')}`,
    `2026-09-20 13:00:00 rescuewait s13: kind=noroom on claude-b reset=${utc('2026-09-20 13:10:00')}`,
    `2026-09-20 13:31:00 rescuewait-end s11: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 600s end=swap`,
    `2026-09-20 13:32:05 rescuewait-end s10: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 1925s end=turned`,
    `2026-09-20 14:00:00 rescuewait-end s9: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 3600s end=swap`,
    '2026-09-20 15:00:00 rescuewait-end s12: kind=noroom on claude reset=- after 9000s end=swap',
    `2026-09-20 15:10:00 rescuewait s14: kind=noroom on claude reset=${utc('2026-09-20 15:05:00')}`,
    `2026-09-20 15:10:00 rescuewait s15: kind=noroom on claude reset=${utc('2026-09-20 15:05:00')}`,
  ];
  const handLog = (): string => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, lines.join('\n') + '\n');
    return log;
  };

  it('every row on a log whose answer is known', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 's13.rescuewait'),
      `state=open kind=noroom since=${utc('2026-09-20 13:00:00')} reset=${utc('2026-09-20 13:10:00')} wrapper=claude-b\n`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 's15.rescuewait'),
      'state=closed kind=near since=1 reset=- wrapper=claude until=2 end=swap\n');
    const r = run(h.home, ['--swap-log', handLog()], { TZ: 'UTC' });
    expect(r.rescues).toBe(11);
    expect(r.sessions_with_4plus_rescues_in_an_hour).toBe(1);
    expect(r.max_rescues_in_an_hour).toBe(4);
    expect(r.rescues_with_a_dated_row).toBe(2);
    expect(r.rescues_on_a_carried_in_banner).toBe(1);
    expect(r.rule1_suppressions_by_via).toEqual({ banner: 1, pane: 2, transcript: 2 });
    expect(r.rule1_pane_suppressions_rescued_within_5min, 's3 and s17; not s19 (8 min), and never s16, a transcript suppression').toBe(2);
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.chain_waits_ending_in_neither_swap_nor_reset, 's6 (clear before its reset) and s8 (no room)').toBe(2);
    expect(r.waits_opened_by_kind).toEqual({ near: 1, noroom: 5 });
    expect(r.waits_ended_by_kind_and_end).toEqual({
      'chain:clear': 1, 'chain:near': 1, 'chain:noroom': 1, 'chain:turned': 1, 'near:swap': 1, 'noroom:swap': 3, 'noroom:turned': 1,
    });
    expect(r.noroom_waits_past_their_reset, 's9 swapped late; s13 open in the registry; not s14 (purged) or s15 (closed)').toBe(2);
    expect(r.noroom_waits_past_their_reset_by_end).toEqual({ open: 1, swap: 1 });
  });

  // §11 item 6, ruled 2026-09-24: a stalled session whose own account is the only
  // one with room idles as today, and the instrument counts it. A still-open wait
  // is measured to the window's end, so this case pins the seconds with `--until`.
  it('no-room waits past their reset: counted to their end or the window\'s, from the reset, beyond the grace', () => {
    const r = run(h.home, ['--swap-log', handLog(), '--since', '2026-09-20 13:45', '--until', '2026-09-20 15:00'], { TZ: 'UTC' });
    expect(r.noroom_waits_past_their_reset, 's9 ended in the window; s13 opened before it and is open at its end').toBe(2);
    expect(r.noroom_waits_past_their_reset_by_end).toEqual({ open: 1, swap: 1 });
    expect(r.noroom_seconds_past_their_reset_max, 's13: 15:00 - 13:10').toBe(6600);
    expect(r.noroom_seconds_past_their_reset_total, 's9: 14:00 - 13:30, plus s13').toBe(1800 + 6600);
    const grace = (src: string, re: RegExp): string => (re.exec(src) ?? ['', 'absent'])[1];
    expect(grace(fs.readFileSync(TOOL, 'utf8'), /^S4_GRACE = (\d+)/m), 'the instrument\'s grace is ccd\'s')
      .toBe(grace(fs.readFileSync(CCD, 'utf8'), /^RESCUE_WAIT_GRACE=(\d+)/m));
  });

  it('--since is inclusive and --until exclusive, as local-time epochs, in either spelling', () => {
    const r = run(h.home, ['--swap-log', handLog(), '--since', '2026-09-20 11:00', '--until', '2026-09-20T11:10'], { TZ: 'UTC' });
    expect(r.rescues, 's3 at 11:03 is in; s4 at 11:10 is at the exclusive bound').toBe(1);
    expect(r.rule1_suppressions_by_via).toEqual({ pane: 1, transcript: 1 });
  });

  it('opens the default log read-only and writes nothing; an absent log says so', () => {
    const log = path.join(h.home, '.cc-sessions', 'swap.log');
    fs.writeFileSync(log, '2026-09-20 10:00:00 swap s1: claude -> claude-a (uuid u1)\n');
    fs.chmodSync(log, 0o444);
    const before = fs.readdirSync(h.home).sort();
    expect(run(h.home).rescues).toBe(0);
    expect(fs.readdirSync(h.home).sort()).toEqual(before);
    expect(run(h.home, ['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('each regex is bound to the line the real ccd writes', () => {
  const ID = 'claude-demo';
  const seedSession = (at: number, row: Record<string, unknown>): void => {
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} home claude; _reg_set ${ID} project demo
          _reg_set ${ID} workdir "$HOME/projects/demo"; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`);
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', uuid: 'b', timestamp: new Date(at * 1000).toISOString(),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'limit' }] },
      isApiErrorMessage: true, error: 'rate_limit', ...row,
    }) + '\n');
  };
  /** The pane's process was born a day ago; `target` is what `_swap_target` answers. */
  const stubs = (pane: string, target: string): string => `tmux() { ${WIDE_PANE} case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; display-message) echo "\${TMUX_CREATED}" ;; esac; return 0; };
    _pane_box_draft() { printf ''; }; _swap_target() { [[ -n "${target}" ]] && echo "${target}"; return 0; }; _dispatch_swap() { :; };`;
  const env = (t: number): Record<string, string> => ({ TMUX_CREATED: String(t - 86400) });

  it('auto-rescue (with its dated tokens), rescuewait, rescuewait-end and carried-in all parse', () => {
    const t = Math.floor(Date.now() / 1000);
    seedSession(t - 5, { quotaLimits: { status: 'rejected', resetsAt: t + 9000, rateLimitType: 'five_hour' } });
    h.sh(`${stubs('❯ ', 'claude-a')} HARD_BLOCK_TYPE=five_hour; HARD_BLOCK_RESET=${t + 300}; _rescuewait_open ${ID} claude near`, env(t));
    h.sh(`${stubs('❯ ', 'claude-a')} _auto_swap_check ${ID}`, env(t));   // closes the near wait as a swap, and logs the rescue
    h.sh(`_carried_in_note ${ID} pane ${t - 100} ${t}`);
    const r = run(h.home);                                                // the DEFAULT log: <home>/.cc-sessions/swap.log
    expect(r.rescues).toBe(1);
    expect(r.rescues_with_a_dated_row).toBe(1);
    expect(r.waits_opened_by_kind).toEqual({ near: 1 });
    expect(r.waits_ended_by_kind_and_end).toEqual({ 'near:swap': 1 });
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.rule1_suppressions_by_via).toEqual({ pane: 1 });
  });

  it('a stranded session\'s no-room wait is counted past its reset; one whose row was written after its own reset adds nothing', () => {
    const t = Math.floor(Date.now() / 1000);
    // The row predates a reset 200 s ago: the no-room wait the strand opens is keyed on it.
    seedSession(t - 5000, { quotaLimits: { status: 'rejected', resetsAt: t - 200, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    expect(run(h.home).noroom_waits_past_their_reset).toBe(1);
    // A row written hours after its own reset: that reset never turned the account, so it keys nothing.
    fs.rmSync(path.join(h.home, '.cc-sessions', 'swap.log'));
    h.sh(`_reg_purge ${ID}`);
    seedSession(t - 5, { quotaLimits: { status: 'rejected', resetsAt: t - 36857, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    const r = run(h.home);
    expect(r.waits_opened_by_kind).toEqual({});
    expect(r.noroom_waits_past_their_reset).toBe(0);
  });

  // S2 at the reset: the armed retry met a 429 with the SAME stale resetsAt, so
  // the newest row postdates the reset the no-room wait keyed on. ccd ends the
  // wait `stale`, and §11 item 6's count leaves it out.
  it('a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset', () => {
    const t = Math.floor(Date.now() / 1000); const R = t - 300;
    seedSession(t - 2000, { quotaLimits: { status: 'rejected', resetsAt: R, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    expect(run(h.home).waits_opened_by_kind).toEqual({ noroom: 1 });
    fs.appendFileSync(h.sh(`_transcript_path ${ID}`), JSON.stringify({
      type: 'assistant', uuid: 'c', timestamp: new Date((R + 2) * 1000).toISOString(),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'limit' }] },
      isApiErrorMessage: true, error: 'rate_limit', quotaLimits: { status: 'rejected', resetsAt: R, rateLimitType: 'five_hour' },
    }) + '\n');
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    const r = run(h.home);
    expect(r.waits_ended_by_kind_and_end).toEqual({ 'noroom:stale': 1 });
    expect(r.noroom_waits_past_their_reset).toBe(0);
  });

  it('a rescue on a carried-in banner is counted against the landing line the real cmd_swap wrote', () => {
    const t = Math.floor(Date.now() / 1000); const born = t - 990;
    seedSession(t - 3000, { quotaLimits: { status: 'rejected', resetsAt: t + 300, rateLimitType: 'five_hour' } });
    const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';
    h.sh(`${SWAP} cmd_swap ${ID} claude-a`, { TMUX: '' });                  // the real landing line
    expect(h.reg(ID, 'wrapper')).toBe('claude-a');
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);   // a landing that never came up (D-3526)
    h.sh(`${stubs('Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ', 'claude-b')} _auto_swap_check ${ID}`,
      { TMUX_CREATED: String(born) });
    const r = run(h.home);
    expect(r.rescues).toBe(1);
    expect(r.rescues_on_a_carried_in_banner).toBe(1);
  });

  // THE TWO ROWS THAT COMPARE A TRUE EPOCH WITH swap.log'S LOCAL STAMP, under a
  // zone that is not UTC (the stage-1 convention, D-3777): ccd writes its
  // `date '+%F %T'` and the instrument reads it back in the SAME zone, so a
  // conversion that ignored the zone (`timegm` for `mktime`) would miscount
  // both by eight hours. On a UTC box every other case here is blind to that.
  it('under TZ=PST8 a stranded wait past its reset and a carried-in rescue still count (departure 3848)', () => {
    const TZ = 'PST8';
    const t = Math.floor(Date.now() / 1000);
    seedSession(t - 5000, { quotaLimits: { status: 'rejected', resetsAt: t - 200, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, { ...env(t), TZ });
    const stranded = run(h.home, [], { TZ });
    expect(stranded.noroom_waits_past_their_reset).toBe(1);
    expect(stranded.noroom_seconds_past_their_reset_max).toBeGreaterThan(0);
    expect(stranded.noroom_seconds_past_their_reset_max).toBeLessThan(3600);
    fs.rmSync(path.join(h.home, '.cc-sessions', 'swap.log'));
    h.sh(`_reg_purge ${ID}`);
    const born = t - 990;
    seedSession(t - 3000, { quotaLimits: { status: 'rejected', resetsAt: t + 300, rateLimitType: 'five_hour' } });
    const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';
    h.sh(`${SWAP} cmd_swap ${ID} claude-a`, { TMUX: '', TZ });
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);
    h.sh(`${stubs('Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ', 'claude-b')} _auto_swap_check ${ID}`,
      { TMUX_CREATED: String(born), TZ });
    expect(run(h.home, [], { TZ }).rescues_on_a_carried_in_banner).toBe(1);
  });

  it('the landing line the carried-in row compares against is cmd_swap\'s own', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain(`echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"`);
  });
});

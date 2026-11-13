// `deploy/measure-continuity.py --stage 3` (session-continuity wave 6a): the graceful stop's time by site and
// mode. READ-ONLY, reads swap.log; pinned as stage 7 is: the counts on a hand-built log, and the regex bound to
// a line the REAL `_graceful_stop_note` wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s3-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number | Record<string, number>>>;
const runBoth = (extra: string[] = [], env: Record<string, string> = {}): { graceful_stop: Row; manifest: Row } => {
  const out = execFileSync('python3', ['-I', TOOL, '--home', h.home, '--stage', '3', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage3: { graceful_stop: Row; manifest: Row } }).stage3;
};
const run = (extra: string[] = [], env: Record<string, string> = {}): Row => runBoth(extra, env).graceful_stop;
const mrun = (extra: string[] = [], env: Record<string, string> = {}): Record<string, any> =>
  runBoth(extra, env).manifest as Record<string, any>;
const L = (stamp: string, id: string, site: string, mode: string, outcome: string): string =>
  `${stamp} graceful-stop ${id}: site=${site} mode=${mode} ${outcome}`;

describe('stage 3 reads the graceful-stop lines (TZ=UTC, hand-built log)', () => {
  it('stage 3 reads the graceful-stop lines by site and mode (TZ=UTC, hand-built log)', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      L('2026-10-05 10:00:00', 's1', 'swap', 'shadow', 'exited=120'),
      L('2026-10-05 10:00:01', 's2', 'swap', 'shadow', 'exited=340'),
      L('2026-10-05 10:00:02', 's3', 'swap', 'shadow', 'exited=900'),
      L('2026-10-05 10:00:03', 's4', 'swap', 'shadow', 'alive=30000'),
      L('2026-10-05 10:00:04', 's5', 'limit-resume', 'live', 'exited=2500'),
      L('2026-10-05 10:00:05', 's6', 'hibernate', 'shadow', 'no-pid'),
      L('2026-10-05 10:00:06', 's7', 'hibernate', 'shadow', 'unmeasured=no-start-time'),
      L('2026-10-05 10:00:07', 's8', 'limit-resume', 'live', 'gone-before-signal'),
      L('2026-10-05 10:00:08', 's9', 'swap', 'shadow', 'exited=12ms'),   // malformed
      L('2026-10-04 09:00:00', 's0', 'swap', 'shadow', 'exited=7'),      // before --since
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.stops).toBe(8);
    expect(r.by_site_mode).toEqual({
      'swap/shadow': { exited: 3, alive: 1, no_pid: 0, gone_before_signal: 0, unmeasured: 0 },
      'limit-resume/live': { exited: 1, alive: 0, no_pid: 0, gone_before_signal: 1, unmeasured: 0 },
      'hibernate/shadow': { exited: 0, alive: 0, no_pid: 1, gone_before_signal: 0, unmeasured: 1 } });
    expect(r.exit_ms).toEqual({ 'swap/shadow': { n: 3, p50: 340, p90: 900, p99: 900, max: 900 },
      'limit-resume/live': { n: 1, p50: 2500, p90: 2500, p99: 2500, max: 2500 } });
    expect(r.censored).toEqual({ 'swap/shadow': 1 });
    expect(r.unmeasured_by_why).toEqual({ 'no-start-time': 1 });
    expect(r.malformed_lines).toBe(1);
  });

  it('alive is censored, never an exit time', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      L('2026-10-05 10:00:00', 's1', 'swap', 'live', 'alive=30000'),
      L('2026-10-05 10:00:01', 's2', 'swap', 'live', 'alive=30001'),
      L('2026-10-05 10:00:02', 's3', 'hibernate', 'live', 'unmeasured=stat-unreadable'),
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.exit_ms).toEqual({});
    expect(r.censored).toEqual({ 'swap/live': 2 });
    expect(r.unmeasured_by_why).toEqual({ 'stat-unreadable': 1 });
  });

  it('no swap.log: the section says absent', () => {
    expect(run(['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('the regex is bound to the line the real _graceful_stop_note writes', () => {
  it('a line the real _graceful_stop_note wrote is read', () => {
    h.sh('_graceful_stop_note lane-a-project-a swap shadow exited=42', { TZ: 'UTC' });
    const r = run([], { TZ: 'UTC' });
    expect((r.exit_ms as Record<string, unknown>)['swap/shadow']).toEqual({ n: 1, p50: 42, p90: 42, p99: 42, max: 42 });
    expect(r.malformed_lines).toBe(0);
  });
});

// ── the manifest section (wave 6b-2) ──
const CLASS_NAMES = ['in-flight', 'holed', 'stopped-agent', 'diverged', 'deferred-until-reset', 'abandoned'];
const COUNT_NAMES = ['items', ...CLASS_NAMES, 'unread', 'unread-expired', 'killed', 'resumed', 'drop-id', 'drop-path',
  'drop-budget', 'drop-shape', 'drop-read', 'drop-readpath', 'drop-over', 'retired'];
/** The header tokens `_inflight_write` passes `_inflight_note`: every count `-` unless given. */
const tokens = (verdict: string, why: string, wait: string, counts: Record<string, number> = {}): string =>
  `verdict=${verdict} why=${why} wait=${wait} ` + COUNT_NAMES.map((c) => `${c}=${c in counts ? counts[c] : (verdict === 'listed' || verdict === 'none' || verdict === 'unread' ? 0 : '-')}`).join(' ');
const ML = (stamp: string, id: string, site: string, tok: string): string => `${stamp} manifest ${id}: site=${site} ${tok}`;
const EL = (stamp: string, id: string, cause: string): string => `${stamp} ended ${id}: ${cause}`;
const write = (lines: string[]): string => {
  const log = path.join(h.home, 'hand-built-swap.log');
  fs.writeFileSync(log, lines.join('\n') + '\n');
  return log;
};
const UTC = { TZ: 'UTC' };
const zeros = (o: Record<string, number>): Record<string, number> => Object.fromEntries(CLASS_NAMES.map((c) => [c, o[c] ?? 0]));

describe('stage 3 reads the manifest lines', () => {
  it('stage 3 reads the manifest lines: restarts by cause, verdicts by site, restarts with items, items by class', () => {
    const log = write([
      EL('2026-11-05 09:00:00', 'old', 'oom'),                                                  // before --since
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'),
      ML('2026-11-05 10:00:01', 'a', 'swap', tokens('listed', '-', '-', { items: 3, 'in-flight': 2, holed: 1 })),
      EL('2026-11-05 10:01:00', 'b', 'limit-resume'),
      ML('2026-11-05 10:01:01', 'b', 'limit-resume', tokens('none', '-', '-')),
      EL('2026-11-05 10:02:00', 'c', 'oom'),
      ML('2026-11-05 10:02:01', 'c', 'revival', tokens('unmeasured', 'busy', '-')),
      EL('2026-11-05 10:03:00', 'd', 'exited'),
      ML('2026-11-05 10:03:01', 'd', 'revival', tokens('not-applicable', '-', '-')),
      EL('2026-11-05 10:04:00', 'e', 'swap-manual'),                                            // no manifest
      EL('2026-11-05 10:05:00', 'f', 'limit-resume'),
      '2026-11-05 10:05:01 dispatch FAILED for f -> claude-b (resume)',
      EL('2026-11-05 10:06:00', 'g', 'swap-auto-rescue'),
      '2026-11-05 10:06:01 swap-refused g: claude -> claude-b (carry failed)',
      EL('2026-11-05 10:07:00', 'i', 'swap-manual'),
      ML('2026-11-05 10:07:01', 'i', 'swap', tokens('listed', '-', '-', { items: 1, abandoned: 1 })),
      '2026-11-05 10:07:02 swap-refused i: claude -> claude-b (target left the roster)',
      ML('2026-11-05 10:08:00', 'z', 'swap', tokens('none', '-', '-')) + ' trailing',          // malformed: a whole line with a tail, which only a prefix match would take
      EL('2026-11-05 11:30:00', 'e', 'oom'),                                                    // e's NEXT ended line, past --until
      ML('2026-11-05 11:30:01', 'e', 'revival', tokens('none', '-', '-')),                      // belongs to that one, not to e's swap-manual
    ]);
    const r = mrun(['--swap-log', log, '--since', '2026-11-05 09:30', '--until', '2026-11-05 11:00'], UTC);
    expect(r.restarts).toBe(8);
    expect(r.restarts_with_items).toBe(2);
    expect(r.restarts_with_resumable_items).toBe(1);
    expect(r.restarts_with_items_by_class).toEqual(zeros({ 'in-flight': 1, holed: 1, abandoned: 1 }));
    expect(r.items_by_class).toEqual(zeros({ 'in-flight': 2, holed: 1, abandoned: 1 }));
    expect(r.unmeasured_by_why.busy).toBe(1);
    expect(r.not_applicable).toBe(1);
    expect(r.never_written_by_cause).toEqual({ 'swap-manual': 1 });
    expect(r.not_restarted).toBe(1);
    expect(r.refused_restart).toBe(2);
    expect(r.malformed_lines).toBe(1);
    expect(r.manifests_by_site_verdict).toEqual({ 'swap/listed': 2, 'limit-resume/none': 1, 'revival/unmeasured': 1, 'revival/not-applicable': 1 });
  });

  it('a manifest line with trailing text after its ended line is malformed and pairs with nothing: the counter and the event parse both fullmatch', () => {
    const log = write([
      EL('2026-11-05 10:00:00', 'p', 'swap-manual'),
      ML('2026-11-05 10:00:01', 'p', 'swap', tokens('listed', '-', '-', { items: 1, 'in-flight': 1 })) + ' trailing',   // a valid line with a tail: only a prefix match takes it
    ]);
    const r = mrun(['--swap-log', log, '--since', '2026-11-05 09:30', '--until', '2026-11-05 11:00'], UTC);
    expect(r.malformed_lines).toBe(1);
    expect(r.manifests_by_site_verdict).toEqual({});
    expect(r.restarts_with_items).toBe(0);
    expect(r.never_written_by_cause).toEqual({ 'swap-manual': 1 });
  });

  it('a manifest line written after --until pairs with its ended line inside the window', () => {
    const log = write([
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'),
      ML('2026-11-05 12:00:00', 'a', 'swap', tokens('listed', '-', '-', { items: 1, 'in-flight': 1 })),
    ]);
    const r = mrun(['--swap-log', log, '--since', '2026-11-05', '--until', '2026-11-05 11:00'], UTC);
    expect(r.restarts).toBe(1);
    expect(r.never_written_by_cause).toEqual({});
    expect(r.restarts_with_items).toBe(1);
  });

  it('weekly waits: wait=604800 with a deferred-until-reset item, wait=90000 with none, wait=86400 with none, wait=3600, wait=?, wait=undated, and two noroom reset=- lines', () => {
    const rows: [string, string, Record<string, number>][] = [
      ['604800', 'a', { items: 1, 'deferred-until-reset': 1 }], ['90000', 'b', {}], ['86400', 'c', {}], ['3600', 'd', {}],
      ['?', 'e', {}], ['undated', 'f', {}]];
    const lines: string[] = [];
    rows.forEach(([w, id, c], i) => {
      lines.push(EL(`2026-11-05 10:0${i}:00`, id, 'limit-resume'), ML(`2026-11-05 10:0${i}:01`, id, 'limit-resume', tokens('listed', '-', w, c)));
    });
    lines.push('2026-11-05 11:00:00 rescuewait x: kind=noroom on claude-a reset=-', '2026-11-05 11:01:00 rescuewait y: kind=noroom on claude-a reset=-',
      '2026-11-05 11:02:00 rescuewait y: kind=noroom on claude-a reset=1780000000');
    const r = mrun(['--swap-log', write(lines), '--since', '2026-11-05'], UTC);
    expect(r.weekly_waits).toEqual({ days_out: 3, days_out_with_items: 1, days_out_deferred: 1, wait_unreadable: 1,
      limitwait_reset_unknown: 1, noroom_reset_unknown: 2 });
  });

  it("first_manifests: a restart whose manifest is its id's first manifest line is counted there, and a later one of the same id is not", () => {
    const lines = [
      '2026-11-05 09:59:00 manifest a: site=swap garbage',                                      // a malformed line is not the id's first
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'), ML('2026-11-05 10:00:01', 'a', 'swap', tokens('listed', '-', '-', { items: 1, 'in-flight': 1 })),
      EL('2026-11-05 10:10:00', 'a', 'swap-auto-rescue'), ML('2026-11-05 10:10:01', 'a', 'swap', tokens('listed', '-', '-', { items: 2, holed: 2 })),
      EL('2026-11-05 10:20:00', 'b', 'oom'), ML('2026-11-05 10:20:01', 'b', 'revival', tokens('none', '-', '-')),
    ];
    const r = mrun(['--swap-log', write(lines), '--since', '2026-11-05'], UTC);
    expect(r.first_manifests).toEqual({ restarts: 2, restarts_with_items: 1, items_by_class: zeros({ 'in-flight': 1 }) });
    expect(r.restarts).toBe(3);
    expect(r.items_by_class).toEqual(zeros({ 'in-flight': 1, holed: 2 }));
  });

  it('an ended line with both dispatch FAILED and swap-refused is not_restarted, never refused_restart or never-written', () => {
    const log = write([
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'),
      '2026-11-05 10:00:01 dispatch FAILED for a -> claude-b (resume)',
      '2026-11-05 10:00:02 swap-refused a: claude -> claude-b (carry failed)',
    ]);
    const r = mrun(['--swap-log', log, '--since', '2026-11-05'], UTC);
    expect(r.not_restarted).toBe(1);
    expect(r.refused_restart).toBe(0);
    expect(r.never_written_by_cause).toEqual({});
  });

  it("a restart with items whose id's next manifest has resumed=1 counts in restarts_with_items_later_resumed", () => {
    const lines = [
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'), ML('2026-11-05 10:00:01', 'a', 'swap', tokens('listed', '-', '-', { items: 1, 'in-flight': 1, resumed: 0 })),
      EL('2026-11-05 10:10:00', 'a', 'swap-auto-rescue'), ML('2026-11-05 10:10:01', 'a', 'swap', tokens('none', '-', '-', { resumed: 1 })),
      EL('2026-11-05 10:20:00', 'b', 'oom'), ML('2026-11-05 10:20:01', 'b', 'revival', tokens('listed', '-', '-', { items: 1, holed: 1, resumed: 0 })),
    ];
    const r = mrun(['--swap-log', write(lines), '--since', '2026-11-05'], UTC);
    expect(r.restarts_with_items_later_resumed).toBe(1);
    expect(r.resumed_items).toBe(1);
  });

  it('drops by why: drop-id, drop-path, drop-budget, drop-shape, drop-read and drop-readpath sum into their own keys; killed sums into killed_in_flight; unread-expired sums into unread_expired', () => {
    const lines = [
      EL('2026-11-05 10:00:00', 'a', 'swap-auto-rescue'),
      ML('2026-11-05 10:00:01', 'a', 'swap', tokens('listed', '-', '-', { items: 1, 'in-flight': 1, 'drop-id': 1, 'drop-path': 2, 'drop-budget': 3, 'drop-shape': 4, 'drop-read': 5, 'drop-readpath': 6, 'drop-over': 7, killed: 2, 'unread-expired': 1 })),
      EL('2026-11-05 10:10:00', 'b', 'oom'),
      ML('2026-11-05 10:10:01', 'b', 'revival', tokens('unread', '-', '-', { items: 1, unread: 1, 'unread-expired': 2, killed: 1, 'drop-id': 1 })),
    ];
    const r = mrun(['--swap-log', write(lines), '--since', '2026-11-05'], UTC);
    expect(r.drops).toEqual({ id: 2, path: 2, budget: 3, shape: 4, read: 5, readpath: 6, over: 7 });
    expect(r.killed_in_flight).toBe(3);
    expect(r.unread_expired).toBe(3);
    expect(r.unread_manifests).toBe(1);
  });
});

describe('the instrument spells the program\'s tuples', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const tuple = (src: string, name: string): string => {
    const m = new RegExp(`^${name} = (\\([^)]*\\))`, 'm').exec(src);
    if (!m) throw new Error(`no ${name}`);
    return m[1];
  };
  it("the instrument's MANIFEST_CLASSES, MANIFEST_VERDICTS, MANIFEST_WHY and MANIFEST_SITES equal the program's, and S3_MANIFEST's alternations are built from them", () => {
    const prog = fs.readFileSync(path.join(ROOT, 'ccd/lib/inflight-manifest.py'), 'utf8');
    const tool = fs.readFileSync(TOOL, 'utf8');
    for (const n of ['MANIFEST_CLASSES', 'MANIFEST_VERDICTS', 'MANIFEST_WHY', 'MANIFEST_SITES']) {
      expect(tuple(tool, n), n).toBe(tuple(prog, n));
    }
    const rx = /S3_MANIFEST = re\.compile\(([\s\S]*?)\n\S/.exec(tool)![1];
    for (const n of ['MANIFEST_SITES', 'MANIFEST_VERDICTS', 'MANIFEST_WHY']) expect(rx, n).toContain(`"|".join(${n})`);
    const ccd = fs.readFileSync(path.join(ROOT, 'ccd/ccd'), 'utf8');
    const body = /^_inflight_write\(\) \{[\s\S]*?\n\}\n/m.exec(ccd)![0];
    const words = [...body.matchAll(/\bwhy="?([a-z][a-z-]*)/g)].map((m) => m[1]);
    expect(words.length).toBeGreaterThan(0);
    const why = new Set(tuple(prog, 'MANIFEST_WHY').match(/[a-z]+/g));
    for (const w of words) expect(why.has(w), `why=${w}`).toBe(true);
  });
});

describe('the section reads what the real _inflight_note writes', () => {
  const SITES = ['swap', 'limit-resume', 'revival'];
  it.each(SITES)('a line the real _inflight_note wrote is read, for every site: %s', (site) => {
    h.sh(`echo "$(date '+%F %T') ended lane-a-project-a: ${site === 'revival' ? 'oom' : site === 'swap' ? 'swap-manual' : 'limit-resume'}" >> "$REG/swap.log"`, UTC);
    h.sh(`_inflight_note lane-a-project-a ${site} "${tokens('listed', '-', '604800', { items: 1, 'in-flight': 1 })}"`, UTC);
    const r = mrun([], UTC);
    expect(r.malformed_lines).toBe(0);
    expect(r.manifests_by_site_verdict).toEqual({ [`${site}/listed`]: 1 });
    expect(r.restarts_with_items_by_site).toEqual({ [site]: 1 });
  });
});

describe('an unreadable swap.log (a directory at its path) is unmeasured, never a traceback', () => {
  it('stage 3 (both sections)', () => {
    const dir = path.join(h.home, 'a-directory');
    fs.mkdirSync(dir);
    const out = runBoth(['--swap-log', dir]);
    expect(out.graceful_stop).toEqual({ swap_log: 'unmeasured', error: 'IsADirectoryError' });
    expect(out.manifest).toEqual({ swap_log: 'unmeasured', error: 'IsADirectoryError' });
  });
});

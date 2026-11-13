// The restart manifest's writer in ccd (session-continuity 6b, Task 3; D-8361, D-8362, D-8366, D-8369, D-8373..D-8376, D-8380).
//
// `_inflight_write` runs `ccd/lib/inflight-manifest.py` under the manifest's OWN slot (`$REG/.inflight.lock`, never the carry's)
// and writes `$REG/<id>.inflight` (a header, then the item lines), the compacted launch record (`<id>.deleg`) and one `manifest`
// line in swap.log, at three sites: the swap, the limit-resume and a revival. It is shadow: nothing reads the file in 6b.
// These rows run the REAL functions in a fixture HOME (`makeCcdHarness`): sidecars, a launch record and a transcript are planted
// by hand, `python3` stubs go first on PATH where a case must not reach the real program, and every name is neutral
// (lane-a, project-a, run ids of the measured shape). Mutation rows (the brief's IF-* table) each go red on a named case below.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ccdSource, CCD, ghContainedEnv, harnessBin, type CcdHarness } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const REPO = path.resolve(__dirname, '../..');
const ID = 'lane-a-project-a';
const UUID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const RUN = 'wf_0123abcd-0ab';
const RUN2 = 'wf_0123abcd-0ac';
const PDIR = '-p';
const WRAPPER = 'claude';
const CFG = '.claude';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-inflight-'); });
afterEach(() => { h.cleanup(); });

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const readOr = (p: string): string | null => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);
const inflight = (): string | null => readOr(reg(`${ID}.inflight`));
const deleg = (): string | null => readOr(reg(`${ID}.deleg`));
const swapLog = (): string => readOr(reg('swap.log')) ?? '';
const now = (): number => Math.floor(Date.now() / 1000);

// ── the grammar ──
const NAMES = ['items', 'in-flight', 'holed', 'stopped-agent', 'diverged', 'deferred-until-reset', 'abandoned', 'unread', 'unread-expired',
  'killed', 'resumed', 'drop-id', 'drop-path', 'drop-budget', 'drop-shape', 'drop-read', 'drop-readpath', 'drop-over', 'retired'];
const COUNTS = NAMES.map((n) => `${n}=(?:\\d+|-)`).join(' ');
const TOKENS = `verdict=(?:listed|none|unread|not-applicable|unmeasured) why=(?:-|busy|budget|time|error) wait=(?:\\d+|-|\\?|undated) ${COUNTS}`;
const HEADER = new RegExp(`^v=1 at=\\d+ gen=\\S+ site=(?:swap|limit-resume|revival) uuid=\\S+ (${TOKENS})$`);
const ITEM = /^class=\S+ kind=(?:workflow|agent) run=\S+ task=\S+ agent=\S+ script=\S* attempts=\d+ since=\d+ reset=\S+ longer=\S+ src=\S+$/;
const MANIFEST_LINE = new RegExp(`^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d manifest ${ID}: site=(?:swap|limit-resume|revival) (${TOKENS})$`);

/** The file's header tokens as a map, plus its item lines. */
const parse = (): { head: Record<string, string>; items: string[]; tokens: string } => {
  const t = inflight();
  expect(t, 'the file exists').not.toBeNull();
  const [first, ...rest] = t!.split('\n');
  const m = HEADER.exec(first!);
  expect(m, `header grammar: ${first}`).not.toBeNull();
  const head = Object.fromEntries(first!.split(' ').map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  return { head, items: rest.filter(Boolean), tokens: m![1]! };
};
const manifestLines = (): string[] => swapLog().split('\n').filter((l) => l.includes(' manifest '));

// ── fixtures ──
const side = (cfg = CFG): string => path.join(h.home, cfg, 'projects', PDIR, UUID);
const put = (p: string, body: string, mtime = now() - 60): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const wfRow = (run = RUN): string => JSON.stringify({ v: 1, t: (now() - 100) * 1000, k: 'workflow', w: 'lane-a', uuid: UUID, run, task: 't1',
  script: `/old/root/projects/${PDIR}/${UUID}/workflows/scripts/x-${run}.js` }) + '\n';
/** The registry row, a transcript, and (when `items`) one in-flight workflow run with its launch row. */
const seed = (o: { items?: boolean; cfg?: string; wrapper?: string } = {}): void => {
  const cfg = o.cfg ?? CFG;
  h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper ${o.wrapper ?? WRAPPER}`);
  put(path.join(h.home, cfg, 'projects', PDIR, `${UUID}.jsonl`), '{}\n');
  if (o.items === false) return;
  fs.writeFileSync(reg(`${ID}.deleg`), wfRow());
  put(path.join(side(cfg), 'subagents', 'workflows', RUN, 'journal.jsonl'), '{"type":"launched"}\n');
  put(path.join(side(cfg), 'workflows', 'scripts', `x-${RUN}.js`), '// x\n');
};

/** `_inflight_write` for the session, with a prefix snippet. Prints `[rc=N]` and the caller's next line. */
const write = (site = 'swap', prefix = '', env: NodeJS.ProcessEnv = {}): string =>
  h.sh(`${prefix}\n_inflight_write ${ID} ${site} "$HOME/${CFG}" ${UUID}; echo "[rc=$?]"; echo NEXT`, env);

/** systemd and tmux stubbed out as `ccd-swap.test.ts` does: the pane is GONE, which the swap's status gate reads as idle. */
const SWAP_STUBS = `systemctl() { :; }; tmux() { case "\${1:-}" in has-session) echo "can't find session: x" >&2; return 1 ;; esac; return 0; }; sleep() { :; };`;

/** The harness's own shell, under a timeout and in a group of its own, for a case that plants a FIFO. */
const shT = (snippet: string, extra: NodeJS.ProcessEnv = {}, timeout = 90_000): { out: string; timedOut: boolean } => {
  const r = spawnSyncGroup('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; '
    + 'unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; source "$ccd_h_src"; FLEET_SPAWN_PINS=; eval "$ccd_h_snippet"'],
  { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...h.env(extra), CCD_HARNESS_SRC: CCD, CCD_HARNESS_SNIPPET: snippet }, { systemd: true, tmux: true }), timeout });
  return { out: String(r.stdout ?? ''), timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' };
};

/** A PATH stub `python3` that logs its call and does `body`. */
const stubPython = (body = 'echo "summary garbage"'): string => {
  const d = path.join(h.home, 'stubbin');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'python3'), `#!/bin/sh\necho "$*" >> "$HOME/py-calls"\n${body}\n`, { mode: 0o755 });
  return 'PATH="$HOME/stubbin:$PATH";';
};
const pyCalls = (): string[] => (readOr(path.join(h.home, 'py-calls')) ?? '').split('\n').filter(Boolean);

const HOLD = (f: string): string => `exec 8>>"$REG/${f}"; flock -n 8 || echo HOLD-FAILED;`;
/** Rewrite `_reg_set` so a write of `field` fails, keeping the real one for the rest. */
const FAIL_SET = (field: string): string => `eval "$(declare -f _reg_set | sed '1s/^_reg_set /_reg_set_real /')"; `
  + `_reg_set() { [[ "$2" == ${field} ]] && return 1; _reg_set_real "$@"; };`;

describe('the manifest writer: results that run no program', () => {
  it('not-applicable: no transcript for the uuid under the config root, or no projects directory; the program never runs and the record is untouched; the file holds the header alone', () => {
    seed({ items: true });
    fs.rmSync(path.join(h.home, CFG, 'projects', PDIR, `${UUID}.jsonl`));   // no transcript for the uuid
    const before = deleg();
    const py = stubPython();
    expect(write('swap', py)).toContain('[rc=0]');
    let p = parse();
    expect(p.head['verdict']).toBe('not-applicable');
    expect(p.head['why']).toBe('-');
    expect(p.head['items']).toBe('-');
    expect(p.items).toEqual([]);
    expect(inflight()!.split('\n')).toHaveLength(1);
    expect(pyCalls(), 'the program never ran').toEqual([]);
    expect(deleg(), 'the record is untouched').toBe(before);
    // no projects directory at all
    fs.rmSync(path.join(h.home, CFG, 'projects'), { recursive: true });
    write('swap', py);
    p = parse();
    expect(p.head['verdict']).toBe('not-applicable');
    expect(pyCalls()).toEqual([]);
    expect(deleg()).toBe(before);
  });

  // root reads any directory, so a mode-000 one is listable there: the case cannot mean anything, and says so as a skip
  it.skipIf(process.getuid?.() === 0)('an unlistable projects directory (mode 000) is unmeasured why=error, never not-applicable', () => {
    seed({ items: false });
    fs.chmodSync(path.join(h.home, CFG, 'projects'), 0o000);   // present, not listable
    try {
      write('swap');
      expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    } finally { fs.chmodSync(path.join(h.home, CFG, 'projects'), 0o755); }
  });

  it('a config root that is not a directory, or a projects entry that is a file, is unmeasured why=error, never not-applicable', () => {
    seed({ items: false });
    fs.writeFileSync(path.join(h.home, 'notadir'), 'x');
    h.sh(`_inflight_write ${ID} swap "$HOME/notadir" ${UUID}`);
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    // a projects entry that is a file (exists, is not a directory) is the same word
    fs.rmSync(path.join(h.home, CFG, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(h.home, CFG, 'projects'), 'x');
    write('swap');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
  });
});

describe('the manifest writer: its own slot', () => {
  it('busy: another holder of .inflight.lock gives verdict=unmeasured why=busy, and the record is not compacted', () => {
    seed();
    const rec = deleg();
    fs.appendFileSync(reg(`${ID}.deleg`), '{"v":1,"t":1,"k":"drop","why":"id"}\n');   // a compaction would remove this extra row's... keep, or shrink
    const before = deleg();
    expect(write('swap', HOLD('.inflight.lock'))).toContain('[rc=0]');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'busy', items: '-' });
    expect(deleg(), 'the record is not compacted').toBe(before);
    expect(rec).not.toBe(before);
  });

  it('its own slot: with .carry.lock held by another process and .inflight.lock free, the manifest still writes listed and compacts the record', () => {
    seed();
    fs.appendFileSync(reg(`${ID}.deleg`), '{"v":1,"t":1,"k":"drop","why":"id"}\n');   // compaction keeps the workflow row only
    const out = write('swap', HOLD('.carry.lock'));
    expect(out).not.toContain('HOLD-FAILED');
    const p = parse();
    expect(p.head).toMatchObject({ verdict: 'listed', why: '-', items: '1' });
    expect(deleg()!.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('its own slot: with .inflight.lock held by another process and .carry.lock free, the manifest writes unmeasured why=busy', () => {
    seed();
    const out = write('swap', HOLD('.inflight.lock'));
    expect(out).not.toContain('HOLD-FAILED');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'busy' });
  });

  it('a busy write after a listed write leaves the header alone in the file, and no items', () => {
    seed();
    write('swap');
    expect(parse().items.length).toBe(1);
    write('swap', HOLD('.inflight.lock'));
    const p = parse();
    expect(p.head['verdict']).toBe('unmeasured');
    expect(p.items).toEqual([]);
    expect(inflight()!.split('\n')).toHaveLength(1);
  });
});

describe('the manifest writer: budget, time and error', () => {
  it('budget: a record priced over INFLIGHT_SCAN_BUDGET gives unmeasured why=budget', () => {
    seed();
    write('swap', 'INFLIGHT_SCAN_BUDGET=10;');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'budget' });
  });

  it('time: a program that outruns INFLIGHT_TIME_S gives unmeasured why=time', () => {
    seed();
    const py = stubPython('exec sleep 60');
    const r = shT(`${py} INFLIGHT_TIME_S=1; CCD_TIMEOUT_KILL_AFTER=1; _inflight_write ${ID} swap "$HOME/${CFG}" ${UUID}; echo "[rc=$?]"`);
    expect(r.timedOut).toBe(false);
    expect(r.out).toContain('[rc=0]');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'time' });
  });

  it('error: a missing program, python3 off PATH, rc 4 or a malformed first line gives unmeasured why=error', () => {
    seed();
    // a malformed first line (a stub that answers garbage at rc 0)
    write('swap', stubPython('echo "summary garbage"'));
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    // an rc the program has no word for
    write('swap', stubPython('exit 2'));
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    // python3 off PATH
    write('swap', 'command() { if [[ "$1 $2" == "-v python3" ]]; then return 1; fi; builtin command "$@"; };');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    // rc 4: the record is not a regular file (a directory)
    fs.rmSync(reg(`${ID}.deleg`));
    fs.mkdirSync(reg(`${ID}.deleg`));
    write('swap');
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
    fs.rmdirSync(reg(`${ID}.deleg`));
    // a missing program: the beside-ccd path is pointed at nothing, and the installed copy is absent
    fs.writeFileSync(reg(`${ID}.deleg`), wfRow());
    h.sh(`eval "$(declare -f _inflight_write | sed 's#.{BASH_SOURCE[^}]*}/lib/#/nonexistent/#')"; _inflight_write ${ID} swap "$HOME/${CFG}" ${UUID}`);
    expect(parse().head).toMatchObject({ verdict: 'unmeasured', why: 'error' });
  });
});

describe('the manifest writer: the listed file', () => {
  it('listed: the header, the items, the compacted record and one manifest line, each fullmatching its grammar', () => {
    seed();
    fs.appendFileSync(reg(`${ID}.deleg`), '{"v":1,"t":1,"k":"drop","why":"id"}\n');
    const out = write('revival');
    expect(out).toContain('[rc=0]');
    const p = parse();
    expect(p.head).toMatchObject({ verdict: 'listed', why: '-', wait: '-', site: 'revival', uuid: UUID, items: '1', 'in-flight': '1' });
    expect(p.items).toHaveLength(1);
    for (const it of p.items) expect(it).toMatch(ITEM);
    expect(p.items[0]).toContain(`run=${RUN}`);
    expect(deleg()!.endsWith('\n')).toBe(true);
    for (const l of deleg()!.split('\n').filter(Boolean)) expect(() => JSON.parse(l)).not.toThrow();
    const ml = manifestLines();
    expect(ml).toHaveLength(1);
    const m = MANIFEST_LINE.exec(ml[0]!);
    expect(m, ml[0]).not.toBeNull();
    expect(m![1], 'the file and the log line agree').toBe(p.tokens);
  });

  it('unread is its own verdict, never none', () => {
    seed();
    const j = path.join(side(), 'subagents', 'workflows', RUN, 'journal.jsonl');
    fs.rmSync(j);
    const r0 = shT(`mkfifo "${j}"`);
    expect(r0.timedOut).toBe(false);
    const r = shT(`_inflight_write ${ID} swap "$HOME/${CFG}" ${UUID}; echo "[rc=$?]"`);
    expect(r.timedOut).toBe(false);
    const p = parse();
    expect(p.head['verdict']).toBe('unread');
    expect(p.head['items']).toBe('0');
    expect(p.head['unread']).toBe('1');
  });

  it('the compacted record ends in a newline: the real hook\'s next append is a line of its own, and every line parses', () => {
    seed();
    fs.appendFileSync(reg(`${ID}.deleg`), '{"v":1,"t":1,"k":"drop","why":"id"}\n');
    write('swap');
    expect(deleg()!.endsWith('\n')).toBe(true);
    // the real hook, in the same fixture HOME: a stub tmux names the pane, the generation file is the row's
    const gen = '0189abcd-1234-5678-9abc-0123456789ab';
    fs.writeFileSync(reg(`${ID}.generation`), gen);
    const answered = path.join(h.home, 'tmux-answered');
    // the hook asks tmux for the pane's name: the stub takes the place of the harness's poisoned tmux, in the same directory
    fs.writeFileSync(path.join(harnessBin(h.home), 'tmux'), `#!/bin/sh\ntrap '' TERM\necho "cc-${ID}"\nprintf '%s\\n' answered >> '${answered}'\n`, { mode: 0o755 });
    const payload = { session_id: UUID, transcript_path: `/rig/${UUID}.jsonl`, cwd: '/rig', hook_event_name: 'PostToolUse', tool_name: 'Workflow',
      tool_input: { script: 'return 1' }, tool_use_id: 'toolu_01AAAA',
      tool_response: { status: 'async_launched', taskId: 't9', runId: RUN2, taskType: 'local_workflow', workflowName: 'demo',
        transcriptDir: `/rig/${UUID}/workflows/${RUN2}`, scriptPath: `/rig/${UUID}/workflows/scripts/x-${RUN2}.js` } };
    const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home, TMUX_PANE: '%1',
      CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: gen, CLAUDE_CODE_EXECPATH: '' }, { systemd: true, tmux: true });
    delete env['OSTYPE'];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = (readOr(answered) ?? '').length;
      const r = spawnSyncGroup('bash', [path.join(REPO, 'ccd', 'session-hook.sh')], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 120_000 });
      expect(r.status).toBe(0);
      if ((readOr(answered) ?? '').length > before) break;
    }
    const rows = deleg()!.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows.map((r) => r.run).filter(Boolean)).toEqual([RUN, RUN2]);
    expect(deleg()!.endsWith('\n')).toBe(true);
  });

  it('a failed record write (a directory at .deleg is rc 4 and never reaches it, so the write itself fails) rewrites the file to unmeasured why=error, and the file and the manifest line agree', () => {
    seed();
    write('swap', FAIL_SET('deleg'));
    const p = parse();
    expect(p.head).toMatchObject({ verdict: 'unmeasured', why: 'error', items: '-' });
    expect(p.items, 'no listed file stands over a record that was not compacted').toEqual([]);
    expect(MANIFEST_LINE.exec(manifestLines()[0]!)![1]).toBe(p.tokens);
  });

  it('releases the slot on every way out: listed, none, budget, time, error and a failed write', () => {
    const probe = path.join(h.home, 'probe');
    const OVERRIDE = `_inflight_note() { local fd; { exec {fd}>>"$REG/.inflight.lock"; } 2>/dev/null || { echo SLOT-ERR >> "${probe}"; return 0; }; `
      + `if flock -n "$fd"; then echo SLOT-FREE >> "${probe}"; else echo SLOT-HELD >> "${probe}"; fi; exec {fd}>&-; return 0; };`;
    const run = (prefix = '', env: NodeJS.ProcessEnv = {}): string => shT(`${OVERRIDE} ${prefix}\n_inflight_write ${ID} swap "$HOME/${CFG}" ${UUID}; echo "[rc=$?]"`, env).out;
    seed();
    run();                                        // listed
    fs.rmSync(reg(`${ID}.deleg`)); fs.rmSync(side(), { recursive: true });
    run();                                        // none (a transcript, nothing launched)
    seed();
    run('INFLIGHT_SCAN_BUDGET=10;');              // budget
    run(stubPython('exec sleep 60') + ' INFLIGHT_TIME_S=1; CCD_TIMEOUT_KILL_AFTER=1;');   // time
    run(stubPython('echo "summary garbage"'));    // error
    fs.rmSync(reg(`${ID}.inflight`), { force: true });
    fs.mkdirSync(reg(`${ID}.inflight`));
    run();                                        // a failed write
    const words = (readOr(probe) ?? '').split('\n').filter(Boolean);
    expect(words).toEqual(Array(6).fill('SLOT-FREE'));
  });
});

describe('the manifest writer: the generation read', () => {
  const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
  it('the generation is read under the row\'s compaction lock, which is never waited for: held by another holder, gen=- and the manifest still writes; free, gen= is the row\'s generation', () => {
    seed();
    fs.writeFileSync(reg(`${ID}.generation`), GEN);
    write('swap');
    expect(parse().head['gen']).toBe(GEN);
    const out = write('swap', `exec 9>>"$REG/.${ID}.compactions.lock"; flock -n 9 || echo HOLD-FAILED;`);
    expect(out).not.toContain('HOLD-FAILED');
    expect(out).toContain('[rc=0]');
    const p = parse();
    expect(p.head['gen']).toBe('-');
    expect(p.head['verdict'], 'the manifest still writes').toBe('listed');
  });
});

describe('the manifest writer: no generation file', () => {
  it('with no generation file the header reads gen=- and no flock, mktemp, link or rm runs for it: the absence is read with builtins', () => {
    seed();
    const d = path.join(h.home, 'stubbin');
    fs.mkdirSync(d, { recursive: true });
    for (const t of ['flock', 'mktemp', 'link']) fs.writeFileSync(path.join(d, t), `#!/bin/sh\necho ${t} >> "$HOME/ext-calls"\nexit 1\n`, { mode: 0o755 });
    // the manifest's own slot uses flock too, so the stub is first on PATH only around the generation read: the slot is taken
    // by the real one through an absolute path in this snippet's override of `command -v`
    const out = write('swap', 'PATH="$HOME/stubbin:$PATH"; _inflight_slot_take() { INFLIGHT_SLOT_FD=""; return 0; };');
    expect(out).toContain('[rc=0]');
    expect(parse().head['gen']).toBe('-');
    expect(readOr(path.join(h.home, 'ext-calls')) ?? '', 'no external ran for the generation read').toBe('');
  });
});

describe('the manifest writer: never dies', () => {
  it('never dies: a directory at $REG/<id>.inflight gives unmeasured why=error, and the caller\'s next line runs', () => {
    seed();
    fs.mkdirSync(reg(`${ID}.inflight`));
    const out = write('swap');
    expect(out).toContain('[rc=0]');
    expect(out).toContain('NEXT');
    expect(manifestLines()[0]).toMatch(/verdict=unmeasured why=error/);
  });

  it('a FIFO at .deleg or at a journal holds nothing: the swap still lands and the limit-resume still runs cmd_ensure', () => {
    seed();
    fs.rmSync(reg(`${ID}.deleg`));
    const STUB = SWAP_STUBS;
    const mk = shT(`mkfifo "$REG/${ID}.deleg"`);
    expect(mk.timedOut).toBe(false);
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    const swap = shT(`${STUB} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(swap.timedOut, swap.out).toBe(false);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    const man = manifestLines();
    expect(man, 'one manifest line for the swap').toHaveLength(1);
    expect(man[0]).toMatch(/why=error/);
    // a journal that is a FIFO (the limit-resume, the record intact)
    fs.rmSync(reg(`${ID}.deleg`)); fs.writeFileSync(reg(`${ID}.deleg`), wfRow());
    const j = path.join(side('.claude-d'), 'subagents', 'workflows', RUN, 'journal.jsonl');
    shT(`rm -f "${j}"; mkdir -p "$(dirname "${j}")"; mkfifo "${j}"`);
    const resume = shT(`${RESUME_STUBS} _watchdog_resume_run ${ID}; echo "[rc=$?]"`);
    expect(resume.timedOut, resume.out).toBe(false);
    expect(h.calls()).toContain('ensure');
  });

  it('an abort inside the body ends only its subshell: the swap still lands and the limit-resume still runs cmd_ensure', () => {
    seed();
    const ABORT = `eval "$(declare -f _inflight_write | sed 's/local id=/: "$ZZ_UNBOUND_X"; local id=/')";`;
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    const STUB = SWAP_STUBS;
    h.sh(`${ABORT} ${STUB} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(manifestLines(), 'the abort ended the body before its log line').toEqual([]);
    h.sh(`${ABORT} ${RESUME_STUBS} _watchdog_resume_run ${ID}`);
    expect(h.calls()).toContain('ensure');
  });
});

/** The limit-resume's collaborators, logging to ccd-calls: stop, kill, the supervised stamp, the manifest line and ensure. */
const RESUME_STUBS = `
  _operator_choice_keep() { :; }; _operator_choice_unmark() { :; }; _graceful_stop_before() { :; }; _graceful_stop_after() { :; }; sleep() { :; };
  _svc_stop() { echo svc-stop >> "$HOME/ccd-calls"; }; _tmx() { echo kill-session >> "$HOME/ccd-calls"; }; cmd_ensure() { echo ensure >> "$HOME/ccd-calls"; };
  eval "$(declare -f _reg_set | sed '1s/^_reg_set /_reg_set_real /')";
  _reg_set() { [[ "$2" == supervised ]] && echo supervised >> "$HOME/ccd-calls"; _reg_set_real "$@"; };
  eval "$(declare -f _inflight_note | sed '1s/^_inflight_note /_inflight_note_real /')";
  _inflight_note() { echo manifest >> "$HOME/ccd-calls"; _inflight_note_real "$@"; };`;

describe('the manifest writer: the wait', () => {
  const limitwait = (rec: string): void => { fs.writeFileSync(reg(`${ID}.limitwait`), rec); };
  const wait = (): string => parse().head['wait']!;

  it('wait: an open limit-wait on the session\'s account gives wait=reset−since, as does one closed end=resume moments ago at the limit-resume; another account\'s, or reset=-, gives wait=-', () => {
    seed();
    limitwait('state=open since=1000 reset=1600 account=claude sign=pane');
    write('swap');
    expect(wait()).toBe('600');
    limitwait(`state=closed since=1000 reset=1600 account=claude sign=pane end=resume until=${now() - 5}`);
    write('limit-resume');
    expect(wait()).toBe('600');
    limitwait('state=open since=1000 reset=1600 account=claude-d sign=pane');
    write('swap');
    expect(wait(), 'another account\'s span').toBe('-');
  });

  it('wait: a revival a day after a limit-resume (the record closed end=resume) gives wait=-, and so does a limit-resume whose close is older than INFLIGHT_WAIT_CLOSED_S', () => {
    seed();
    limitwait(`state=closed since=1000 reset=1600 account=claude sign=pane end=resume until=${now() - 86_400}`);
    write('revival');
    expect(wait()).toBe('-');
    limitwait(`state=closed since=1000 reset=1600 account=claude sign=pane end=resume until=${now() - 700}`);
    write('limit-resume');
    expect(wait(), 'a wait already counted').toBe('-');
    limitwait(`state=closed since=1000 reset=1600 account=claude sign=pane end=resume until=${now() - 5}`);
    write('revival');
    expect(wait(), 'a closed record at any other site').toBe('-');
  });

  it('wait: a reset already past at the opening gives wait=0; an unreadable record gives wait=?; neither is a malformed line', () => {
    seed();
    limitwait('state=open since=1000 reset=500 account=claude sign=pane');
    write('swap');
    expect(wait()).toBe('0');
    fs.rmSync(reg(`${ID}.limitwait`));
    fs.symlinkSync('/dev/null', reg(`${ID}.limitwait`));
    write('swap');
    expect(wait()).toBe('?');
    expect(MANIFEST_LINE.test(manifestLines().at(-1)!)).toBe(true);
  });

  it('wait: an open limit-wait on the session\'s account with reset=- gives wait=undated, not -', () => {
    seed();
    limitwait('state=open since=1000 reset=- account=claude sign=pane');
    write('swap');
    expect(wait()).toBe('undated');
    expect(parse().head['verdict']).toBe('listed');
  });
});

describe('the manifest writer: its three sites', () => {
  it('the swap writes it at the destination root after the carry', () => {
    seed();
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    fs.appendFileSync(reg('swap.log'), `2026-11-10 10:00:00 sidecar ${UUID} diverged ${side('.claude-d')}/subagents/workflows/${RUN}/journal.jsonl longer /old/x\n`);
    const STUB = SWAP_STUBS
      // a diverged line THIS carry writes (a stub carry, so the line lands after `log-from` was measured)
      + `eval "$(declare -f _swap_carry_sidecars | sed '1s/^_swap_carry_sidecars /_swap_carry_sidecars_real /')"; `
      + `_swap_carry_sidecars() { _swap_carry_sidecars_real "$@"; echo "$(date '+%F %T') sidecar ${UUID} diverged ${side('.claude-d')}/subagents/workflows/${RUN2}/journal.jsonl longer /new/x" >> "$REG/swap.log"; };`;
    put(path.join(side(), 'subagents', 'workflows', RUN2, 'journal.jsonl'), '{"type":"launched"}\n');
    fs.appendFileSync(reg(`${ID}.deleg`), wfRow(RUN2));
    h.sh(`${STUB} cmd_swap ${ID} claude-d`, { TMUX: '' });
    const lines = swapLog().split('\n');
    const iSide = lines.findIndex((l) => l.includes(' sidecar ') && l.includes('(')), iMan = lines.findIndex((l) => l.includes(' manifest ')), iSwap = lines.findIndex((l) => / swap lane-a-project-a: /.test(l));
    expect(iSide).toBeGreaterThanOrEqual(0);
    expect(iMan).toBeGreaterThan(iSide);
    expect(iSwap).toBeGreaterThan(iMan);
    const p = parse();
    const byRun = Object.fromEntries(p.items.map((i) => [/run=(\S+)/.exec(i)![1], /class=(\S+)/.exec(i)![1]]));
    expect(byRun[RUN2], 'a diverged line from this carry is read').toBe('diverged');
    expect(byRun[RUN], 'one already in the log is not').toBe('in-flight');
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(inflight()).toContain(`uuid=${UUID}`);
  });

  it('limit-resume writes it after the stop and the supervised stamp, and before cmd_ensure', () => {
    seed();
    h.sh(`${RESUME_STUBS} _watchdog_resume_run ${ID}`);
    const calls = h.calls();
    const at = (w: string): number => calls.indexOf(w);
    expect(calls).toEqual(['svc-stop', 'kill-session', 'supervised', 'manifest', 'ensure']);
    expect(at('svc-stop')).toBeLessThan(at('kill-session'));
    expect(parse().head['site']).toBe('limit-resume');
  });

  it('a revival writes it after its ended line; a swap end of the last 60 s writes neither', () => {
    seed();
    h.sh(`_end_cause() { echo exited; }; _end_note_gone ${ID}`);
    const lines = swapLog().split('\n');
    const iEnd = lines.findIndex((l) => l.includes(` ended ${ID}: exited`)), iMan = lines.findIndex((l) => l.includes(' manifest '));
    expect(iEnd).toBeGreaterThanOrEqual(0);
    expect(iMan).toBeGreaterThan(iEnd);
    expect(parse().head['site']).toBe('revival');
    fs.rmSync(reg('swap.log')); fs.rmSync(reg(`${ID}.inflight`));
    h.sh(`_reg_set ${ID} lastend "$(date +%s) swap-manual"; _end_cause() { echo exited; }; _end_note_gone ${ID}`);
    expect(swapLog()).toBe('');
    expect(inflight()).toBeNull();
  });
});

describe('the manifest writer: pins and the census', () => {
  const src = ccdSource();
  const hook = fs.readFileSync(path.join(REPO, 'ccd', 'session-hook.sh'), 'utf8');
  const program = fs.readFileSync(path.join(REPO, 'ccd', 'lib', 'inflight-manifest.py'), 'utf8');
  const lines = src.split('\n');
  const fnBody = (name: string): string[] => {
    const i = lines.findIndex((l) => l.startsWith(`${name}() {`));
    expect(i, `${name} is defined`).toBeGreaterThanOrEqual(0);
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j += 1;
    return lines.slice(i, j + 1);
  };
  const code = (ls: string[]): string[] => ls.filter((l) => !/^\s*#/.test(l));
  const num = (text: string, name: string): number => Number(new RegExp(`(?:^|\\s)${name}=(\\d+)`, 'm').exec(text)?.[1]);

  it('the hook\'s LRC_MAX_BYTES and LRC_DROP_RESERVE equal ccd/ccd\'s LAUNCH_RECORD_MAX_BYTES and LAUNCH_RECORD_DROP_RESERVE, and _inflight_write passes their sum', () => {
    expect(num(src, 'LAUNCH_RECORD_MAX_BYTES')).toBe(num(hook, 'LRC_MAX_BYTES'));
    expect(num(src, 'LAUNCH_RECORD_DROP_RESERVE')).toBe(num(hook, 'LRC_DROP_RESERVE'));
    expect(Number.isFinite(num(src, 'LAUNCH_RECORD_MAX_BYTES'))).toBe(true);
    expect(code(fnBody('_inflight_write')).join('\n')).toContain('"$((LAUNCH_RECORD_MAX_BYTES + LAUNCH_RECORD_DROP_RESERVE))"');
  });

  it('the manifest sites: _inflight_write is called in cmd_swap, _watchdog_resume_run and _end_note_gone, where the plan places it, and nowhere else', () => {
    const holders: Record<string, string> = {};
    let cur = '';
    for (const l of lines) {
      const d = /^([A-Za-z_][\w-]*)\(\) *\{/.exec(l);
      if (d) cur = d[1]!;
      if (/^\s*#/.test(l) || cur === '_inflight_write') continue;
      const m = /_inflight_write "\$id" (\S+)/.exec(l);
      if (m) holders[cur] = m[1]!;
    }
    expect(holders).toEqual({ cmd_swap: 'swap', _watchdog_resume_run: 'limit-resume', _end_note_gone: 'revival' });
    const sites = /MANIFEST_SITES = \(([^)]*)\)/.exec(program)![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(Object.values(holders).sort()).toEqual([...sites].sort());
    const idx = (body: string[], re: RegExp): number => body.findIndex((l) => re.test(l));
    const swap = code(fnBody('cmd_swap'));
    expect(idx(swap, /_inflight_write "\$id" swap "\$dstcfg" "\$uuid" "\$mlog"/)).toBeGreaterThan(idx(swap, /^\s*_swap_carry_sidecars "\$srccfg"/));
    const afterCarry = swap.slice(idx(swap, /^\s*_swap_carry_sidecars "\$srccfg"/));
    expect(idx(afterCarry, /_inflight_write "\$id" swap/)).toBeLessThan(idx(afterCarry, /^\s*_swap_beat_stop "\$beat"\s*$/));
    expect(idx(swap, /mlog=\$\(_plat_size/)).toBeLessThan(idx(swap, /^\s*_swap_carry_sidecars "\$srccfg"/));
    const wd = code(fnBody('_watchdog_resume_run'));
    expect(idx(wd, /_inflight_write "\$id" limit-resume/)).toBeGreaterThan(idx(wd, /_reg_set "\$id" supervised/));
    expect(idx(wd, /_inflight_write "\$id" limit-resume/)).toBeLessThan(idx(wd, /cmd_ensure "\$id"/));
    expect(idx(wd, /_reg_set "\$id" supervised/)).toBeGreaterThan(idx(wd, /^\s*sleep 1/));
    const gone = code(fnBody('_end_note_gone'));
    expect(idx(gone, /_inflight_write "\$id" revival/)).toBeGreaterThan(idx(gone, /_end_record "\$id"/));
    for (const f of ['cmd_hibernate', 'cmd_stop', 'cmd_ws_archive', 'cmd_ensure', '_spawn_start']) {
      expect(code(fnBody(f)).join('\n'), f).not.toContain('_inflight_write');
    }
    const w = code(fnBody('_inflight_write')).join('\n');
    const s = code(fnBody('_inflight_slot_take')).join('\n');
    for (const t of [w, s]) expect(t).not.toMatch(/\.carry\.lock|_carry_slot_take|CARRY_SLOT_FD/);
    expect(s).toContain('"$REG/.inflight.lock"');
    expect(w.match(/_inflight_slot_take/g)).toHaveLength(1);
    expect(code(lines).filter((l) => l.includes('.inflight.lock')), 'only the slot helper names the file').toHaveLength(1);
  });
});

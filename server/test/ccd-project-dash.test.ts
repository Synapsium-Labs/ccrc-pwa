// A PROJECT OR A TEMP-ROOT ID NEVER BEGINS WITH "-" (path-identity spec §2.4).
// A dash-leading project is the one path by which ccd could mint an id spelled
// as a flag: project `-` with slug `actor` is `--actor`. So `_ws_project_valid`
// refuses a leading `-` at every site that creates under a project: ws-add,
// start, enable (which now asks, its wrapper first, before it journals) and
// project-pool. And
// `_ws_tmproot_id_ok` is re-derived from `_reg_id_ok`, so the witness, the
// records, the slots, ws-collect and its audit refuse a dash-leading id through
// one spelling of the dash rule. It agrees with the server's `isTmpRootId` on
// every name but length.
// FIXTURE HOME ONLY (`makeCcdHarness`). Every ccd call goes through `h.sh`, so
// this file spawns no bash of its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, readJournal } from './lifecycleHelpers.js';
import { isTmpRootId } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-project-dash-'); });
afterEach(() => { h.cleanup(); });

/** `ccd-start-id.test.ts`'s stubs, copied rather than imported. `_supervised_start` logs its argv to
 *  `$HOME/ccd-calls` instead of reaching a manager, and `_alive` answers "no", so a start that is NOT
 *  refused leaves a `supervised_start` line behind. */
const START_STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

interface ShResult { code: number; stdout: string; stderr: string }

/** `h.sh`, with a refusal captured rather than thrown. */
const shFail = (snippet: string): ShResult => {
  try {
    return { code: 0, stdout: h.sh(snippet), stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const regDir = (): string => path.join(h.home, '.cc-sessions');
const reapLocks = (): string[] => fs.readdirSync(regDir()).filter((f) => f.startsWith('.reap-')).sort();
const startedIds = (): string[] =>
  h.calls().filter((l) => l.startsWith('supervised_start ')).map((l) => l.split(' ')[1] ?? '');

describe('a project or temp-root id never begins with "-" (path-identity spec §2.4)', () => {
  it('_ws_project_valid refuses -lead and --reason, and still refuses .hidden', () => {
    const out = h.sh(`for p in demo a-b p.v2 -lead --reason .hidden; do
  if _ws_project_valid "$p"; then printf '%s accept\\n' "$p"; else printf '%s refuse\\n' "$p"; fi
done`);
    expect(out.split('\n')).toEqual([
      'demo accept', 'a-b accept', 'p.v2 accept', '-lead refuse', '--reason refuse', '.hidden refuse',
    ]);
  });

  it('ws-add refuses a dash-leading project positionally, with no row and no worktree', () => {
    // POSITIONAL: ws-add's loop has no arm for `-lead`, so its catch-all binds it as the project.
    const main = h.makeRepo('-lead');
    const r = shFail(`${WS_ADD} cmd_ws_add -lead quiet-basin`);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain("invalid project '-lead'");
    expect(fs.existsSync(path.join(regDir(), '-lead-quiet-basin.uuid')), 'a row was written').toBe(false);
    expect(fs.existsSync(path.join(h.home, 'worktrees', '-lead', 'quiet-basin')), 'a worktree was added').toBe(false);
    expect(fs.existsSync(path.join(regDir(), '.ws-add--lead.lock')), 'refused after the ws-add lock').toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin'), 'a ws/ branch was cut').toBe('');
  }, 60_000);

  it('start refuses a dash-leading project, with no row and no supervised start', () => {
    fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
    const r = shFail(`${START_STUBS} cmd_start claude-b -lead`);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain("invalid project '-lead'");
    expect(fs.existsSync(path.join(regDir(), 'claude-b--lead.uuid')), 'a row was written').toBe(false);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: the same stubs start a plain project, so an empty call log is the refusal's, not the stubs'.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(shFail(`${START_STUBS} cmd_start claude-b demo`).code).toBe(0);
    expect(startedIds()).toEqual(['claude-b-demo']);
  }, 60_000);

  it('enable refuses a dash- or dot-leading project before it journals', () => {
    for (const p of ['-lead', '.hidden']) {
      fs.mkdirSync(path.join(h.home, 'projects', p), { recursive: true });
      // An archive marker planted for the composed id. The check must precede `_ws_expire_refuse_return`: that gate
      // opens a permanent `.reap-<id>.lock` for an archived id and clears its archive, journaling `unarchive`.
      fs.writeFileSync(path.join(regDir(), `claude-b-${p}.archived`), '1700000000\n');
      const r = shFail(`${START_STUBS} cmd_enable claude-b ${p}`);
      expect(r.code, `${p}: ${r.stdout}`).not.toBe(0);
      expect(r.stderr, p).toContain(`invalid project '${p}'`);
      expect(readJournal(h.home).filter((e) => e['id'] === `claude-b-${p}`), `${p}: a journal row names the id`)
        .toEqual([]);
      expect(fs.existsSync(path.join(regDir(), `claude-b-${p}.archived`)), `${p}: the planted archive marker was cleared`)
        .toBe(true);
    }
    expect(reapLocks(), 'a reap lock was opened for a refused id').toEqual([]);
    expect(eventsOf(h.home, 'enable'), 'an enable row was journaled').toEqual([]);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: a plain project journals exactly one enable row, so the reader above can see one.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(shFail(`${START_STUBS} cmd_enable claude-b demo`).code).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id'])).toEqual(['claude-b-demo']);
  }, 60_000);

  it('enable refuses an unrostered or flag-spelled wrapper before it journals or locks', () => {
    // `cmd_start` refuses the same wrapper with the same words, but only after enable's expiry gate and its
    // `enable` line. enable's loop has no arm for `--actor`, so its catch-all binds it positionally and the
    // composed id is `--actor-demo`.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    for (const w of ['acct-unrostered', '--actor']) {
      const id = `${w}-demo`;
      // An archive marker planted for the composed id, as in the project case above: past the check, the expiry
      // gate would open a permanent `.reap-<id>.lock` and clear the archive, journaling `unarchive`.
      fs.writeFileSync(path.join(regDir(), `${id}.archived`), '1700000000\n');
      const r = shFail(`${START_STUBS} cmd_enable ${w} demo`);
      expect(r.code, `${w}: ${r.stdout}`).not.toBe(0);
      expect(r.stderr, w).toContain(`unknown wrapper '${w}'`);
      expect(readJournal(h.home).filter((e) => e['id'] === id), `${w}: a journal row names the id`).toEqual([]);
      expect(fs.existsSync(path.join(regDir(), `${id}.archived`)), `${w}: the planted archive marker was cleared`)
        .toBe(true);
    }
    expect(reapLocks(), 'a reap lock was opened for a refused id').toEqual([]);
    expect(eventsOf(h.home, 'enable'), 'an enable row was journaled').toEqual([]);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: a rostered wrapper on the same project journals exactly one enable row.
    expect(shFail(`${START_STUBS} cmd_enable claude-b demo`).code).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id'])).toEqual(['claude-b-demo']);
  }, 60_000);

  it('enable answers start\'s usage line for an empty wrapper or project, before it journals, locks or clears an archive', () => {
    // Spec §2.9 promises "cmd_start's own check and words", and cmd_start's first test is the usage line. So an empty
    // wrapper or project is answered with that line by an EXPLICIT check, never by letting it fall through: past
    // enable's checks `enable '' demo` composes `-demo`, passes the id cap, and the expiry gate opens a permanent
    // `.reap--demo.lock`, clears the archive and journals `unarchive` before cmd_start gets to say a word.
    const USAGE = 'ccd: usage: ccd start <id> | ccd start <wrapper> <project> [workdir]';
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    // [argv as typed, the archive marker planted for the id those words compose]
    const FORMS: readonly (readonly [string, string])[] = [
      [`'' demo`, '-demo'],
      [`claude-b ''`, 'claude-b-'],
      [`'' ''`, '-'],
    ];
    for (const [argv] of FORMS) {
      // The CONTROL for the "matching start" claim: start itself answers this line for the same forms.
      const s = shFail(`${START_STUBS} cmd_start ${argv}`);
      expect(s.code, `start ${argv}: ${s.stdout}`).toBe(1);
      expect(s.stderr.trim(), `start ${argv}`).toBe(USAGE);
    }
    for (const [, id] of FORMS) fs.writeFileSync(path.join(regDir(), `${id}.archived`), '1700000000\n');
    for (const [argv, id] of FORMS) {
      const r = shFail(`${START_STUBS} cmd_enable ${argv}`);
      expect(r.code, `enable ${argv}: ${r.stdout}`).toBe(1);
      expect(r.stderr.trim(), `enable ${argv}`).toBe(USAGE);
      expect(fs.existsSync(path.join(regDir(), `${id}.archived`)), `enable ${argv}: the planted archive marker was cleared`)
        .toBe(true);
    }
    expect(readJournal(h.home), 'a journal row was written').toEqual([]);
    expect(reapLocks(), 'a reap lock was opened for a refused id').toEqual([]);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: a plain pair journals exactly one enable row, so the reader above can see one.
    expect(shFail(`${START_STUBS} cmd_enable claude-b demo`).code).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id'])).toEqual(['claude-b-demo']);
  }, 60_000);

  it('project-pool refuses a dash-leading project, and nothing lands under pools/', () => {
    fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
    const pools = h.sh('printf %s "$POOLS_DIR"');
    for (const argv of ['--project -lead --pool pool-a', '--project -lead --clear']) {
      const r = shFail(`cmd_project_pool ${argv}`);
      expect(r.code, argv).not.toBe(0);
      expect(r.stderr, argv).toContain("invalid project '-lead'");
    }
    expect(fs.existsSync(path.join(pools, '-lead')), 'a tag was written').toBe(false);
    // The CONTROL: the same verb tags a plain project at the path the assertion above reads.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(h.sh('cmd_project_pool --project demo --pool pool-a')).toBe('tagged demo pool-a');
    expect(fs.readFileSync(path.join(pools, 'demo'), 'utf8')).toBe('pool-a');
  }, 60_000);

  it('each refusal says "no LEADING dot or dash"', () => {
    h.makeRepo('-lead');
    const SITES: readonly (readonly [string, string])[] = [
      ['ws-add', `${WS_ADD} cmd_ws_add -lead quiet-basin`],
      ['start', `${START_STUBS} cmd_start claude-b -lead`],
      ['enable', `${START_STUBS} cmd_enable claude-b -lead`],
      ['project-pool', 'cmd_project_pool --project -lead --pool pool-a'],
    ];
    for (const [verb, snippet] of SITES) {
      const r = shFail(snippet);
      expect(r.code, verb).not.toBe(0);
      expect(r.stderr, verb).toContain('and no LEADING dot or dash');
    }
  }, 60_000);

  it('_ws_tmproot_id_ok refuses -x-y and .x-y, and accepts demo-quiet-mesa', () => {
    const out = h.sh(`for i in demo-quiet-mesa p.v2-quiet-mesa -x-y .x-y --actor; do
  if _ws_tmproot_id_ok "$i"; then printf '%s ok\\n' "$i"; else printf '%s no\\n' "$i"; fi
done`);
    expect(out.split('\n')).toEqual(['demo-quiet-mesa ok', 'p.v2-quiet-mesa ok', '-x-y no', '.x-y no', '--actor no']);
  });

  it('_ws_tmproot_id_ok is derived from _reg_id_ok, so the dash rule has one spelling', () => {
    // A copy that spelled the dash rule inline (`!= [.-]*`) would answer every row above alike. Only this
    // line tells the derivation from a second spelling.
    const defs = fs.readFileSync(CCD, 'utf8').split('\n').filter((l) => l.startsWith('_ws_tmproot_id_ok() {'));
    expect(defs).toHaveLength(1);
    expect(defs[0]).toContain('_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }');
  });

  it('the collect audit dies "bad session id" for -x-y before anything is read, with no .reap-* lock', () => {
    // A witness-named file stands, so an id the predicate let through would go on to the population check and the lock.
    fs.mkdirSync(path.join(regDir(), 'tmproots'), { recursive: true });
    fs.writeFileSync(path.join(regDir(), 'tmproots', '-x-y'), 'junk\n');
    const r = shFail('cmd_ws_audit --session -x-y --collect');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('bad session id');
    expect(reapLocks()).toEqual([]);
  }, 60_000);

  it('_ws_tmproot_id_ok and isTmpRootId agree on every name except length', () => {
    const NAMES = ['demo-quiet-mesa', '.x-y', '-x-y', 'a/b', 'a b', '', 'a=b'] as const;
    const out = h.sh(`for i in ${NAMES.map((n) => `'${n}'`).join(' ')}; do
  if _ws_tmproot_id_ok "$i"; then printf 'ok\\n'; else printf 'no\\n'; fi
done`);
    const ccd = out.split('\n');
    expect(ccd, 'one answer per name').toHaveLength(NAMES.length);
    expect(Object.fromEntries(NAMES.map((n, i) => [n, ccd[i] === 'ok'])))
      .toEqual(Object.fromEntries(NAMES.map((n) => [n, isTmpRootId(n)])));
    // Guards the guard: the table holds an accepted name, so equality is not two all-false columns.
    expect(NAMES.filter((n) => isTmpRootId(n))).toEqual(['demo-quiet-mesa']);
    // THE ONE STATED DIFFERENCE, pinned so it stays the only one: the server bounds the length, and ccd's predicate does not.
    const long = `${'p'.repeat(250)}-quiet-mesa`;
    expect(h.sh(`_ws_tmproot_id_ok '${long}' && echo ok || echo no`)).toBe('ok');
    expect(isTmpRootId(long)).toBe(false);
  });
});

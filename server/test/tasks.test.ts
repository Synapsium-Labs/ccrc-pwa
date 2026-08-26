import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readTasks, taskProgress, tasksDir } from '../src/tasks/read.js';
import { liveSessionStatus } from '../src/livestate.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';

const UUID = '72be9ee2-fe16-4bcc-b60b-0cfc0dc3d199';

/** A config dir with a task dir seeded from `files` (name → raw file body). */
function seed(files: Record<string, string>): string {
  const cfg = mkTmp('ccrc-tasks-');
  const dir = tasksDir(cfg, UUID);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return cfg;
}

const task = (id: string, subject: string, status: string, activeForm = ''): string =>
  JSON.stringify({ id, subject, description: `do ${id}`, activeForm, status, blocks: [], blockedBy: [] });

describe('readTasks', () => {
  it('reads every task file in task-number order', async () => {
    const cfg = seed({
      '9.json': task('9', 'nine', 'pending'),
      '10.json': task('10', 'ten', 'completed'),
      '2.json': task('2', 'two', 'in_progress', 'Doing two'),
    });
    const { tasks } = await readTasks(localIO, cfg, UUID);
    // Numeric order, not lexicographic — "10" must not sort before "2".
    expect(tasks.map((t) => t.id)).toEqual(['2', '9', '10']);
    expect(tasks[0]).toEqual({
      id: '2', subject: 'two', description: 'do 2', activeForm: 'Doing two', status: 'in_progress',
    });
  });

  it('ignores the dir bookkeeping and unreadable records', async () => {
    const cfg = seed({
      '1.json': task('1', 'real', 'pending'),
      '.lock': '',
      '.highwatermark': '7',
      'notes.json': task('99', 'not a task file', 'pending'),
      '2.json': '{"id":"2","subj', // half-written file — routine, we read live
      '3.json': '{"id":"3"}',      // no subject → not a task record
    });
    const { tasks } = await readTasks(localIO, cfg, UUID);
    expect(tasks.map((t) => t.id)).toEqual(['1']);
  });

  it('counts an unrecognised status as outstanding, never as done', async () => {
    const cfg = seed({ '1.json': task('1', 'one', 'deferred') });
    const { tasks } = await readTasks(localIO, cfg, UUID);
    expect(tasks[0]!.status).toBe('pending');
  });

  it('returns [] when the session has no task dir at all', async () => {
    const cfg = mkTmp('ccrc-tasks-');
    expect(await readTasks(localIO, cfg, UUID)).toEqual({ tasks: [], unmeasured: 0, listed: false });
  });
});

describe('taskProgress', () => {
  it('summarizes counts and names the running task', async () => {
    const cfg = seed({
      '1.json': task('1', 'one', 'completed'),
      '2.json': task('2', 'two', 'completed'),
      '3.json': task('3', 'three', 'in_progress', 'Building the thing'),
      '4.json': task('4', 'four', 'pending'),
    });
    expect(taskProgress(await readTasks(localIO, cfg, UUID))).toEqual({
      total: 4, done: 2, running: 1, active: 'Building the thing',
    });
  });

  it('names the running task by subject when it carries no activeForm', async () => {
    const cfg = seed({ '1.json': task('1', 'Restart the poller', 'in_progress') });
    expect(taskProgress(await readTasks(localIO, cfg, UUID))?.active).toBe('Restart the poller');
  });

  it('is null for a session with no task list', () => {
    expect(taskProgress({ tasks: [], unmeasured: 0, listed: true })).toBeNull();
  });
});

describe('liveSessionStatus', () => {
  it('treats shell (a Bash command running) as busy, not idle', () => {
    expect(liveSessionStatus('shell')).toBe('busy');
    expect(liveSessionStatus('busy')).toBe('busy');
    expect(liveSessionStatus('idle')).toBe('idle');
  });

  it('defaults an unknown status to busy — new work is likelier than new rest', () => {
    expect(liveSessionStatus('compacting')).toBe('busy');
    expect(liveSessionStatus('')).toBe('busy');
  });
});


// D-115's third consumer, and the one that contradicts a rule written eight
// lines above the defect. `parseTask(null)` answered null for a file this box
// could not read, `readTasks` pushed it nowhere, and the task left BOTH the
// numerator and the DENOMINATOR — so a plan of three whose third file went
// unreadable rendered `2/2` on the fleet card: a finished plan, with a task
// still outstanding in it. `parseTask`'s own comment states the rule the fold
// broke, eight lines up: "An unknown status counts as outstanding rather than
// done — over-reporting progress is the one wrong answer here."
//
// A COUNT, NOT A PLACEHOLDER ROW. Synthesising a `TaskItem` for the file would
// need a `subject`, and there is none to read — an invented one would print on
// the operator's screen and in `draftPr`'s "## Plan" checklist as though the
// session had written it. Only the denominator was wrong; only the denominator
// moves, which is why `readTasks` answers a pair rather than a longer list.
describe('readTasks — the task file whose bytes never came back', () => {
  const three = (): string => seed({
    '1.json': task('1', 'one', 'completed'),
    '2.json': task('2', 'two', 'completed'),
    '3.json': task('3', 'three', 'pending'),
  });

  // The listed-but-its-bytes-never-came-back shape, through the tree's own
  // `FleetIO` double rather than the filesystem — REAL under every runner,
  // including the root one the chmod twin below has to skip. It is also the
  // shape the remote fleet actually produces: one dropped agent-WS round trip
  // on a file that is certainly there (`ioDoubles.ts`).
  it('an unreadable task file stays in the denominator', async () => {
    const cfg = three();
    const io = degradedReadIO((p) => p === path.join(tasksDir(cfg, UUID), '3.json'));
    const read = await readTasks(io, cfg, UUID);
    expect(read.unmeasured).toBe(1);
    // No invented row, and no invented subject: the file contributes a count
    // and nothing else.
    expect(read.tasks.map((t) => t.id)).toEqual(['1', '2']);
    expect(taskProgress(read)).toEqual({ total: 3, done: 2, running: 0, active: null });
  });

  // …and the same thing against a real EACCES, which is what the local fleet
  // produces. Skipped as root (D-116): `chmod 000` denies root nothing, so an
  // unguarded case would quietly assert the OPPOSITE of its own name there.
  it.skipIf(process.getuid?.() === 0)(
    'a real EACCES (chmod 000) counts too — 2/3, not the 2/2 this fixture used to read',
    async () => {
      const cfg = three();
      const file = path.join(tasksDir(cfg, UUID), '3.json');
      chmodSync(file, 0o000);
      try {
        const read = await readTasks(localIO, cfg, UUID);
        expect(read.unmeasured).toBe(1);
        expect(taskProgress(read)).toMatchObject({ done: 2, total: 3 });
      } finally {
        chmodSync(file, 0o644);   // let the fixture cleanup remove it without fighting perms
      }
    },
  );

  // The other half of the measured read, and the reason this is a two-arm
  // decision rather than "count every failure". A file listed by `readdir` and
  // gone by the time its own bytes were asked for was DELETED between the two
  // syscalls — Claude Code rewrites this directory while we read it — and a
  // deleted task is not an outstanding one. Only a proven ENOENT reaches this
  // arm (`io.ts`'s `ReadFailure`), so the fail-shut direction is preserved:
  // everything the box could not prove gone counts.
  it('an ABSENT task file is a raced deletion, not an unknown — it leaves the denominator', async () => {
    const cfg = three();
    const io = absentReadIO((p) => p === path.join(tasksDir(cfg, UUID), '3.json'));
    const read = await readTasks(io, cfg, UUID);
    expect(read.unmeasured).toBe(0);
    expect(taskProgress(read)).toEqual({ total: 2, done: 2, running: 0, active: null });
  });

  it('an ABSENT task directory is still an empty read, not a progress row', async () => {
    const cfg = mkTmp('ccrc-tasks-');
    expect(await readTasks(localIO, cfg, 'no-such-uuid')).toEqual({ tasks: [], unmeasured: 0, listed: false });
    expect(taskProgress(await readTasks(localIO, cfg, 'no-such-uuid'))).toBeNull();
  });

  // The gate that used to be `tasks.length === 0` alone. A session whose EVERY
  // task file is unreadable has a plan — the directory is right there, three
  // files in it — and answering `null` would render the same "this session has
  // no task list" the empty case renders, which is the over-report one step
  // further along: not "2 of 2 done" but "there was never anything to do".
  it('a plan whose every file is unreadable is a 0/3 row, not a session with no plan', async () => {
    const cfg = three();
    const dir = tasksDir(cfg, UUID);
    const io = degradedReadIO((p) => p.startsWith(dir + path.sep));
    const read = await readTasks(io, cfg, UUID);
    // `listed: true` is the point of the case beside `unmeasured: 3`: the
    // directory answered, and every file in it did not.
    expect(read).toEqual({ tasks: [], unmeasured: 3, listed: true });
    expect(taskProgress(read)).toEqual({ total: 3, done: 0, running: 0, active: null });
  });

  // The running task still names itself. `active` and `running` are read off
  // the tasks that WERE measured, so an unmeasured file adds to the tally
  // without touching the line the strip prints — there is nothing to print.
  it('an unmeasured file changes the tally and nothing else', async () => {
    const cfg = seed({
      '1.json': task('1', 'one', 'completed'),
      '2.json': task('2', 'two', 'in_progress', 'Doing two'),
      '3.json': task('3', 'three', 'pending'),
    });
    const io = degradedReadIO((p) => p === path.join(tasksDir(cfg, UUID), '3.json'));
    expect(taskProgress(await readTasks(io, cfg, UUID)))
      .toEqual({ total: 3, done: 1, running: 1, active: 'Doing two' });
  });
});

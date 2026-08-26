// The session's task list, read from the same place the TUI reads it: Claude
// Code keeps one JSON per task under `<configDir>/tasks/<session-uuid>/<n>.json`
// and rewrites it in place on every status change. That file set — not the
// transcript — is the source of truth: the PWA's 50-event backlog would drop
// tasks created earlier in the conversation, and a compaction rotates the
// transcript while the task list survives.
import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { TaskItem, TaskProgress, TaskStatus } from '../../../shared/api.js';

/** Task files are named by task number; anything else in the dir (`.lock`,
 *  `.highwatermark`) is bookkeeping we ignore. */
const TASK_FILE_RE = /^(\d+)\.json$/;

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed'];

export function tasksDir(configDir: string, uuid: string): string {
  return path.join(configDir, 'tasks', uuid);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One task file's BYTES → TaskItem; null when it isn't a task record at all.
 *  Malformed JSON and half-written files are routine here (Claude Code writes
 *  these while we read them), so every failure is a skip, never a throw.
 *
 *  Takes a `string`, not a `string | null`, since D-115: the null used to
 *  arrive from `io.readFile` as well, so this function was where a file that
 *  could not be READ became indistinguishable from a file that was read and
 *  found to say nothing — and both then vanished from the tally. Whether a
 *  read happened is now decided one level up, where the answer that carries
 *  it still exists (`readTasks`), and this function only ever sees bytes. */
function parseTask(raw: string): TaskItem | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (o === null || typeof o !== 'object') return null;
  const t = o as Record<string, unknown>;
  const id = str(t.id);
  const subject = str(t.subject);
  if (id === '' || subject === '') return null;
  // An unknown status counts as outstanding rather than done — over-reporting
  // progress is the one wrong answer here.
  const status = (STATUSES.includes(str(t.status)) ? t.status : 'pending') as TaskStatus;
  return { id, subject, activeForm: str(t.activeForm), description: str(t.description), status };
}

/**
 * One read of one session's task directory: the tasks it could read, and how
 * many task files it could NOT read at all.
 *
 * The pair exists because those two numbers answer different questions and
 * only one of them has rows. `tasks` is what the strip prints; `unmeasured` is
 * a COUNT and nothing more — a file this box failed to read carries no
 * subject, no status and no activeForm, and there is no honest row to make out
 * of it. Synthesising a placeholder `TaskItem` would put invented text on the
 * operator's screen and into `draftPr`'s "## Plan" checklist as though the
 * session had written it.
 *
 * D-115: `readTasks` used to return the bare list, so an unreadable file left
 * BOTH the numerator and the denominator and a plan of three whose third file
 * went unreadable rendered `2/2` — a finished plan with a task still
 * outstanding in it. That is the exact answer `parseTask`'s own comment
 * forbids eight lines up ("over-reporting progress is the one wrong answer
 * here"), reached by a path that never got as far as a status word. Widening
 * the RETURN TYPE rather than adding a second function is deliberate: it makes
 * every call site a compile error until it has said what it does with the
 * count, which is the only mechanism that stops one being missed.
 */
export interface TasksRead {
  tasks: TaskItem[];
  /** Task files listed in the directory whose bytes this box could not read.
   *  Outstanding-of-unknown-status, not missing: see `readTasks`. */
  unmeasured: number;
  /** Whether the task DIRECTORY answered at all. False means `io.readdir`
   *  returned null, which folds two conditions this reader cannot part —
   *  "no such directory" (the ordinary shape: most sessions never make a task
   *  list) and "the directory is there and would not list" (EACCES; in remote
   *  mode one dropped agent-WS round trip). `io.readdir` has no measured
   *  variant, so the distinction is not available HERE — but the consumer
   *  needs the fold flagged even so, because the two share the one recovery:
   *  do not overwrite a tally that was measured a moment ago with a zero
   *  nobody measured.
   *
   *  D-115's remedy stopped at `readFileMeasured`, one seam BELOW this. Every
   *  task file being unreadable is now honestly reported as `0/N`; the
   *  directory failing to list still reports nothing at all, which the card
   *  renders identically to "this session never had a plan". Fixed at the
   *  consumer (`watch.ts`'s `sweepTasks`) rather than here, because a
   *  measured `readdir` is a new wire op and a new frame — D-114's family,
   *  and not this branch's to open. */
  listed: boolean;
}

/**
 * Every task for `uuid`, in task-number order (the order the ids were minted —
 * display grouping by status is the UI's job), plus the count of task files
 * that could not be read. Missing directory → an empty read: most sessions
 * never create a task list, and that isn't an error.
 *
 * `readFileMeasured`, not `readFile` (D-115). The two failure arms are the
 * whole point and they part company here:
 *
 *  - `unreadable` — the file is LISTED and its bytes never came back (EACCES;
 *    in remote mode one dropped agent-WS round trip). Claude Code numbers a
 *    task file when it creates the task, so the task exists and its status is
 *    unknown, and an unknown status counts as outstanding. It goes in
 *    `unmeasured`, i.e. in the denominator.
 *  - `absent` — a PROVEN ENOENT (`io.ts`'s `ReadFailure` gives that word to
 *    nothing else), so between `readdir` listing the name and this read asking
 *    for its bytes the file was deleted. Claude Code rewrites this directory
 *    underneath us; a deleted task is not an outstanding one and is counted
 *    nowhere. The asymmetry is the fail-shut direction: everything this box
 *    could not PROVE gone is still work to do.
 *
 * A file that reads back fine and fails `parseTask` (truncated JSON caught
 * mid-write, a record naming no subject) is left where it has always been —
 * out of both counts. That is the same over-report one condition over and it
 * is deliberately NOT changed here: this read measured those bytes and found
 * they do not describe a task, which is a different sentence from "the read
 * did not happen", and D-115 is about the second one.
 */
export async function readTasks(
  io: FleetIO,
  configDir: string,
  uuid: string,
): Promise<TasksRead> {
  const dir = tasksDir(configDir, uuid);
  const names = await io.readdir(dir);
  if (names === null) return { tasks: [], unmeasured: 0, listed: false };
  const files = names
    .filter((n) => TASK_FILE_RE.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const reads = await Promise.all(files.map((n) => io.readFileMeasured(path.join(dir, n))));
  const tasks: TaskItem[] = [];
  let unmeasured = 0;
  for (const read of reads) {
    if (!read.ok) {
      if (read.reason === 'unreadable') unmeasured++;
      continue;
    }
    const t = parseTask(read.content);
    if (t) tasks.push(t);
  }
  return { tasks, unmeasured, listed: true };
}

/**
 * Fleet-card summary. Nothing read and nothing unread → null, so a session
 * with no plan shows no progress row at all rather than a hollow "0/0".
 *
 * `unmeasured` lands in the TOTAL and nowhere else (D-115). It is not `done`
 * — that is the over-report this exists to stop — and it is not `running` or
 * `active` either: those are read off the tasks that were actually measured,
 * because a file whose bytes never arrived cannot be the one to name what the
 * session is doing.
 *
 * The empty gate reads BOTH numbers on purpose. A session whose every task
 * file is unreadable has a plan — the directory is right there with files in
 * it — and answering null would render exactly what "this session never made a
 * task list" renders, which is the same over-report one step further along:
 * not "2 of 2 done" but "there was never anything to do".
 */
export function taskProgress(read: TasksRead): TaskProgress | null {
  const { tasks, unmeasured } = read;
  if (tasks.length === 0 && unmeasured === 0) return null;
  const running = tasks.filter((t) => t.status === 'in_progress');
  const first = running[0];
  return {
    total: tasks.length + unmeasured,
    done: tasks.filter((t) => t.status === 'completed').length,
    running: running.length,
    // Not every task carries an activeForm — fall back to its subject rather
    // than leaving the card with a bare tally and no idea what's running.
    active: first ? first.activeForm || first.subject : null,
  };
}

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

/** One task file → TaskItem; null when it isn't a task record at all. Malformed
 *  JSON and half-written files are routine here (Claude Code writes these while
 *  we read them), so every failure is a skip, never a throw. */
function parseTask(raw: string | null): TaskItem | null {
  if (raw === null) return null;
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
 * Every task for `uuid`, in task-number order (the order the ids were minted —
 * display grouping by status is the UI's job). Missing directory → empty list:
 * most sessions never create a task list, and that isn't an error.
 */
export async function readTasks(
  io: FleetIO,
  configDir: string,
  uuid: string,
): Promise<TaskItem[]> {
  const dir = tasksDir(configDir, uuid);
  const names = await io.readdir(dir);
  if (names === null) return [];
  const files = names
    .filter((n) => TASK_FILE_RE.test(n))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const raws = await Promise.all(files.map((n) => io.readFile(path.join(dir, n))));
  const out: TaskItem[] = [];
  for (const raw of raws) {
    const t = parseTask(raw);
    if (t) out.push(t);
  }
  return out;
}

/** Fleet-card summary. Empty list → null, so a session with no plan shows no
 *  progress row at all rather than a hollow "0/0". */
export function taskProgress(tasks: TaskItem[]): TaskProgress | null {
  if (tasks.length === 0) return null;
  const running = tasks.filter((t) => t.status === 'in_progress');
  const first = running[0];
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'completed').length,
    running: running.length,
    // Not every task carries an activeForm — fall back to its subject rather
    // than leaving the card with a bare tally and no idea what's running.
    active: first ? first.activeForm || first.subject : null,
  };
}

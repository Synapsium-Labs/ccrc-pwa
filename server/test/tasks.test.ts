import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readTasks, taskProgress, tasksDir } from '../src/tasks/read.js';
import { liveSessionStatus } from '../src/livestate.js';
import { localIO } from '../src/io.js';

const UUID = '72be9ee2-fe16-4bcc-b60b-0cfc0dc3d199';

/** A config dir with a task dir seeded from `files` (name → raw file body). */
function seed(files: Record<string, string>): string {
  const cfg = mkdtempSync(path.join(tmpdir(), 'ccrc-tasks-'));
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
    const tasks = await readTasks(localIO, cfg, UUID);
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
    const tasks = await readTasks(localIO, cfg, UUID);
    expect(tasks.map((t) => t.id)).toEqual(['1']);
  });

  it('counts an unrecognised status as outstanding, never as done', async () => {
    const cfg = seed({ '1.json': task('1', 'one', 'deferred') });
    const tasks = await readTasks(localIO, cfg, UUID);
    expect(tasks[0]!.status).toBe('pending');
  });

  it('returns [] when the session has no task dir at all', async () => {
    const cfg = mkdtempSync(path.join(tmpdir(), 'ccrc-tasks-'));
    expect(await readTasks(localIO, cfg, UUID)).toEqual([]);
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
    expect(taskProgress([])).toBeNull();
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

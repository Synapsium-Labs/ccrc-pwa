// D-8147: `POST /api/sessions/:id/pr` refuses a public project's title or body that names its team's tracker id,
// before any ccd call; a private or unmeasured project's text is sent as the operator wrote it.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let coord: CoordStore;
let app: FastifyInstance | undefined;
let calls: string[][];

function seed(): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const worktree = path.join(home, 'w');
  mkdirSync(worktree);
  for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', worktree], ['project', 'project-a'],
    ['workspace', 'key-123-fix'], ['branch', 'ws/quiet-basin'], ['base', 'origin/main']]) {
    writeFileSync(path.join(reg, `project-a-key-123-fix.${f}`), v!);
  }
}

beforeEach(() => {
  home = mkTmp('ccrc-pr-open-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  calls = [];
  seed();
});
afterEach(async () => { await app?.close(); app = undefined; coord.db.close(); rmSync(home, { recursive: true, force: true }); });

const open = async (title: string, body: string) => {
  const run: Runner = async (_c, args) => {
    calls.push(args);
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  await app?.close();
  app = await buildServer({ ...testDeps(home, run), coord });
  return app.inject({ method: 'POST', url: '/api/sessions/project-a-key-123-fix/pr', payload: { title, body } });
};
const sentToCcd = (): boolean => calls.some((a) => a[0] === 'pr-open');

const LINE = JSON.stringify({
  id: 'project-a-key-123-fix', project: 'project-a', repo: 'owner/repo', branch: 'ws/key-123-fix',
  base: 'origin/main', baseShort: 'main', tip: 'f'.repeat(40), ahead: 1, dirty: 0,
  commits: [{ sha: 'aaaaaaa', subject: 'the work', body: '' }], template: null, rows: [],
  phase: 'none', number: null, checkedAt: 1785300000000, reason: null,
});

describe('GET /api/sessions/:id/pr and the linking standard', () => {
  const draftBody = async (): Promise<string> => {
    const run: Runner = async (_c, args) => {
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
      return { ran: true, code: 0, stdout: LINE, stderr: '' };
    };
    await app?.close();
    app = await buildServer({ ...testDeps(home, run), coord });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/project-a-key-123-fix/pr' });
    return (res.json() as { draft: { body: string } }).draft.body;
  };

  it("a project with no linking row keeps today's footer (no key, nothing to protect)", async () => {
    expect(await draftBody()).toContain('Opened from ccrc workspace `project-a-key-123-fix`');
  });

  it("a private project's draft carries Refs KEY-123; a public one's names no id", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'private' }, 'test', 1);
    expect(await draftBody()).toContain('Refs KEY-123');
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'test', 2);
    const publicBody = await draftBody();
    expect(publicBody).not.toContain('Refs');
    // the footer names neither the workspace id nor the branch, both of which can carry the ticket
    expect(publicBody).not.toMatch(/key-123/i);
    expect(publicBody).toContain('Opened from ccrc');
  });
});

describe('POST /api/sessions/:id/pr and the linking standard', () => {
  it("a public project's PR naming KEY-123 is refused tracker-id-public and ccd is not called", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'test', 1);
    const res = await open('Fix the login (KEY-123)', 'Body text\n');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'tracker-id-public', ids: ['KEY-123'], mode: 'public' });
    expect(sentToCcd()).toBe(false);
    const inBody = await open('Fix the login', 'Closes key-123\n');
    expect(inBody.json()).toMatchObject({ error: 'tracker-id-public', ids: ['KEY-123'] });
    expect(sentToCcd()).toBe(false);
  });

  it("a public project's PR naming no id is sent", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'test', 1);
    const res = await open('Fix the login', 'Closes #12\n');
    expect(res.statusCode).toBe(200);
    expect(sentToCcd()).toBe(true);
  });

  it("a private project's PR naming KEY-123 is sent", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'private' }, 'test', 1);
    const res = await open('Fix the login', 'Closes KEY-123\n');
    expect(res.statusCode).toBe(200);
    expect(sentToCcd()).toBe(true);
  });

  it("an unmeasured project's PR naming KEY-123 is refused (nothing measured is public)", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: null }, 'test', 1);
    const res = await open('Fix the login', 'Closes KEY-123\n');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'tracker-id-public', ids: ['KEY-123'] });
    expect(sentToCcd()).toBe(false);
  });

  it("a failed reading with a last good public one stays public", async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: null }, 'test', 1);
    coord.recordLinkingReading('project-a', { state: 'measured', visibility: 'public', slug: 'owner/repo', template: 'absent', at: 5 });
    coord.recordLinkingReading('project-a', { state: 'failed', reason: 'timeout', at: 6 });
    const res = await open('Fix the login', 'Closes KEY-123\n');
    expect(res.statusCode).toBe(409);
    expect(sentToCcd()).toBe(false);
  });

  it("a head branch named for the team's ticket is refused on a public project, and said to be the branch", async () => {
    writeFileSync(path.join(home, '.cc-sessions', 'project-a-key-123-fix.branch'), 'ws/key-123-fix');
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'test', 1);
    const res = await open('Fix the login', 'Closes #12\n');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'tracker-id-public', ids: ['KEY-123'], in: 'branch', mode: 'public' });
    expect(sentToCcd()).toBe(false);
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'private' }, 'test', 2);
    expect((await open('Fix the login', 'Closes #12\n')).statusCode).toBe(200);
  });

  it('a head branch carrying the ticket anywhere in its name is refused too', async () => {
    writeFileSync(path.join(home, '.cc-sessions', 'project-a-key-123-fix.branch'), 'ws/fix-key-123-crash');
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'public' }, 'test', 1);
    const res = await open('Fix the login', 'Closes #12\n');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'tracker-id-public', ids: ['KEY-123'], in: 'branch' });
    expect(sentToCcd()).toBe(false);
  });

  it('a measured-public repository stays public under a stored private override', async () => {
    coord.setLinking('project-a', { teamKey: 'KEY', override: 'private' }, 'test', 1);
    coord.recordLinkingReading('project-a', { state: 'measured', visibility: 'public', slug: 'owner/repo', template: 'absent', at: 5 });
    const res = await open('Fix the login', 'Closes KEY-123\n');
    expect(res.statusCode).toBe(409);
    expect(sentToCcd()).toBe(false);
  });
});

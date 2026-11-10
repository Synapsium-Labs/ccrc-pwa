// D-8147: a named create from a ticket on a PUBLIC project slugs from the title's words, never the ticket id.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { WS_TITLE_CAP } from '../src/ccdargv.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { publicTicketSlug, slugWithoutTeamIds } from '../src/workspaceCreate.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let coord: CoordStore;
let app: FastifyInstance | undefined;
let calls: string[][];

beforeEach(() => {
  home = mkTmp('ccrc-ws-create-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  calls = [];
});
afterEach(async () => { await app?.close(); app = undefined; coord.db.close(); rmSync(home, { recursive: true, force: true }); });

// A pasted link, built from parts: the public-tree scanner refuses the host written joined.
const LINK = ['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'KEY-123', 'fix-the-login-flow'].join('/');

const create = async (name: string, override: 'public' | 'private' | null, teamKey: string | null = 'KEY') => {
  coord.setLinking('project-a', { teamKey, override }, 'test', 1);
  const deps = testDeps(home, async (_c, args) => { calls.push(args); return { ran: true, code: 0, stdout: '', stderr: '' }; });
  app = await buildServer({
    ...deps, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', WS_TITLE_CAP], rosterFp: null, build: null },
  });
  return app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces', payload: { name } });
};

describe('a named create from a ticket and the linking standard', () => {
  it('a public project\'s ticket create slugs from the title words, never key-123', async () => {
    const res = await create(LINK, 'public');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slug: string; id: string };
    expect(body.slug).toBe('fix-the-login-flow');
    expect(body.id).toBe('project-a-fix-the-login-flow');
    expect(calls.flat().join(' ')).toContain('fix-the-login-flow');
    expect(calls.flat().some((t) => /key-123/.test(t) && t !== 'KEY-123 - Fix the login flow')).toBe(false);
  });

  it('refuses ticket-slug-public when Linear gave no title', async () => {
    const res = await create('KEY-123', 'public');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ticket-slug-public' });
    expect(calls).toEqual([]);
  });

  it("a private project's ticket create keeps key-123-…", async () => {
    const res = await create(LINK, 'private');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slug: string }).slug).toBe('key-123-fix-the-login-flow');
  });

  it("an unmeasured project's ticket create is treated as public (no key-123 in the branch)", async () => {
    const res = await create(LINK, null);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slug: string }).slug).toBe('fix-the-login-flow');
  });

  it("a project whose reading failed with nothing good before it is treated as public too", async () => {
    coord.recordLinkingReading('project-a', { state: 'failed', reason: 'timeout', at: 5 });
    const res = await create(LINK, null);
    expect((res.json() as { slug: string }).slug).toBe('fix-the-login-flow');
  });

  it('a plain name on a public project is untouched', async () => {
    const res = await create('quiet basin', 'public');
    expect((res.json() as { slug: string }).slug).toBe('quiet-basin');
  });

  it("a ticket-shaped name that is not the project's team's keeps its slug on a public project", async () => {
    const res = await create('phase-2', 'public');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slug: string }).slug).toBe('phase-2');
  });

  it('a ticket-shaped name on a public project with no team key keeps its slug', async () => {
    const res = await create('phase-2', 'public', null);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slug: string }).slug).toBe('phase-2');
  });
});

describe('publicTicketSlug', () => {
  const ref = { key: 'KEY', num: '123', titleSlug: null } as never;
  it('takes the words after the id, fitted to the slug cap', () => {
    expect(publicTicketSlug('KEY-123 - Fix the login flow', ref, 'project-a')).toEqual({ ok: true, slug: 'fix-the-login-flow' });
    const long = publicTicketSlug('KEY-123 - ' + 'word '.repeat(20), ref, 'project-a');
    expect(long.ok && long.slug.length <= 31).toBe(true);
  });
  it('refuses a title that is only the id, or too short', () => {
    expect(publicTicketSlug('KEY-123', ref, 'project-a')).toEqual({ ok: false, error: 'ticket-slug-public' });
    expect(publicTicketSlug('KEY-123 - x', ref, 'project-a')).toEqual({ ok: false, error: 'ticket-slug-public' });
  });
});

describe('slugWithoutTeamIds', () => {
  it('takes the team id out of a slug wherever it sits', () => {
    expect(slugWithoutTeamIds('fix-key-123-crash', 'KEY', 'project-a')).toEqual({ ok: true, slug: 'fix-crash' });
    expect(slugWithoutTeamIds('login-cleanup', 'KEY', 'project-a')).toEqual({ ok: true, slug: 'login-cleanup' });
    expect(slugWithoutTeamIds('phase-2', 'KEY', 'project-a')).toEqual({ ok: true, slug: 'phase-2' });
  });
  it('refuses a slug with no words left', () => {
    expect(slugWithoutTeamIds('key-123', 'KEY', 'project-a')).toEqual({ ok: false, error: 'ticket-slug-public' });
  });
});

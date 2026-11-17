// The directory's status types (D-8180, plan task 1.4): the project-status page reader over FX2's recorded answer
// (D-8407), `statusOfType` (by type, never by name), and the refresher's wave-3 refresh, which sends the four documents, then the project statuses and the initiatives probe.
import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LinearStoreRecord } from '../../shared/linear.js';
import type { FetchLike } from '../src/linear/client.js';
import { keyTailOf } from '../src/linear/connection.js';
import {
  LINEAR_DIRECTORY_COLLECTIONS, LINEAR_DIRECTORY_DOCUMENTS, LINEAR_HIERARCHY_DOCUMENTS, readLinearProjectStatusesPage,
  statusOfType, type LinearDirectoryEntries,
} from '../src/linear/ops.js';
import { putLinearSlot, type LinearSlotRef } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { linearAnswer, RATELIMITED_ERRORS } from './linearFetchFake.js';
import { linearRecord } from './linearRecorded.js';
import { linearServicesFake } from './linearServicesFake.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY = 'lin_api_fixture1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const T = 1_800_000_000_000;
const VIEWER = '88888888-0000-4000-8000-000000000001';
const ID = (n: number): string => `55555555-0000-4000-8000-${String(n).padStart(12, '0')}`;

const entries = (over: Partial<LinearDirectoryEntries> = {}): LinearDirectoryEntries => ({
  viewerId: null, states: [], labels: [], projects: [], users: [], projectStatuses: [], initiatives: 'unknown', ...over,
});

describe('the project-status page reader (recorded fixture)', () => {
  it('a directory page of project statuses reads id, name and type', () => {
    // The directory's page is the same document the row reads: FX2's one recording answers both.
    const rec = linearRecord('read-project-statuses');
    expect(rec.document).toBe(LINEAR_HIERARCHY_DOCUMENTS.projectStatuses);
    const page = readLinearProjectStatusesPage(rec.body);
    expect(page).toEqual({
      ok: true,
      statuses: [
        { id: '00000000-0008-4000-8000-000000000024', name: 'Planned', type: 'planned' },
        { id: '00000000-0008-4000-8000-000000000025', name: 'Backlog', type: 'backlog' },
        { id: '00000000-0008-4000-8000-000000000026', name: 'Canceled', type: 'canceled' },
        { id: '00000000-0008-4000-8000-000000000027', name: 'Completed', type: 'completed' },
        { id: '00000000-0008-4000-8000-000000000028', name: 'In Progress', type: 'started' },
      ],
    });
  });

  it('a page out of its grammar is malformed, and an answer with errors is its word', () => {
    expect(readLinearProjectStatusesPage({ data: { projectStatuses: { nodes: [{ id: 'x', name: 'A', type: 'started' }] } } }))
      .toEqual({ ok: false, word: 'malformed' });
    expect(readLinearProjectStatusesPage({ data: {} })).toEqual({ ok: false, word: 'malformed' });
    expect(readLinearProjectStatusesPage({ errors: [{ message: 'x' }] }).ok).toBe(false);
  });
});

describe('statusOfType', () => {
  it('statusOfType finds by type and ignores a renamed name', () => {
    const dir = entries({
      projectStatuses: [{ id: ID(1), name: 'Planned', type: 'planned' }, { id: ID(2), name: 'Shipped', type: 'completed' }],
      states: [
        { id: ID(3), name: 'Todo', type: 'unstarted', teamKey: 'AAA' },
        { id: ID(4), name: 'Shipped', type: 'completed', teamKey: 'BBB' },
        { id: ID(5), name: 'Finished', type: 'completed', teamKey: 'AAA' },
      ],
    });
    expect(statusOfType(dir, 'project', 'completed', null)).toEqual({ id: ID(2) });
    expect(statusOfType(dir, 'issue', 'completed', 'AAA')).toEqual({ id: ID(5) });
    expect(statusOfType(dir, 'issue', 'completed', 'BBB')).toEqual({ id: ID(4) });
    expect(statusOfType(dir, 'issue', 'completed', null)).toEqual({ id: ID(4) });
  });

  it('statusOfType answers null when no status has the type', () => {
    const dir = entries({
      projectStatuses: [{ id: ID(1), name: 'Planned', type: 'planned' }],
      states: [{ id: ID(3), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }],
    });
    expect(statusOfType(dir, 'project', 'canceled', null)).toBeNull();
    expect(statusOfType(dir, 'issue', 'canceled', 'AAA')).toBeNull();
    expect(statusOfType(dir, 'issue', 'unstarted', 'BBB')).toBeNull();
    expect(statusOfType(null as unknown as LinearDirectoryEntries, 'project', 'x', null)).toBeNull();
  });
});

describe('the refresher since wave 3', () => {
  /** The last refresh's project-statuses mark (D-8701), read beside its entries. */
  let statusesMark: 'read' | 'unread' | null = null;
  /** One refresher over a fresh slot; each body of `statusesBodies` answers one refresh in turn (the first by a name miss,
   *  each later one by `queueDirectory`, past the window). Answers the directory as the last refresh left it. */
  async function refreshWith(probe: (q: string) => unknown, ...statusesBodies: (() => unknown)[]): Promise<LinearDirectoryEntries | null> {
    const bodies = statusesBodies.length > 0 ? statusesBodies : [() => linearRecord('read-project-statuses').body];
    let turn = 0;
    const dir = path.join(mkTmp('ccrc-linear-dirh-'), '.ccrc');
    mkdirSync(dir, { recursive: true });
    sent.length = 0;
    const conn = (nodes: unknown[]): Record<string, unknown> => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
    const f: FetchLike = async (_u, init) => {
      const q = (JSON.parse(init.body) as { query: string }).query;
      sent.push(q);
      const body = q === LINEAR_DIRECTORY_DOCUMENTS.states ? { data: { workflowStates: conn([]) } }
        : q === LINEAR_DIRECTORY_DOCUMENTS.labels ? { data: { issueLabels: conn([]) } }
        : q === LINEAR_DIRECTORY_DOCUMENTS.projects ? { data: { projects: conn([]) } }
        : q === LINEAR_DIRECTORY_DOCUMENTS.users ? { data: { viewer: { id: VIEWER }, users: conn([]) } }
        : q === LINEAR_HIERARCHY_DOCUMENTS.projectStatuses ? bodies[Math.min(turn, bodies.length - 1)]!()
        : probe(q);
      return linearAnswer({ ok: true, status: 200, json: async () => body });
    };
    const fx = linearServicesFake({ clock: () => T, ccrcDir: dir, fetch: f });
    const rec: LinearStoreRecord = {
      workspaceId: WS_A, name: 'Workspace', urlKey: 'ws-a', user: 'user-a', teams: [{ id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA', name: 'Team A' }],
      teamsAt: T, keyTail: keyTailOf(KEY), keyDigest: valueDigestHex(KEY), checkedAt: T, outcome: 'ok',
    };
    await putLinearSlot(dir, KEY, rec, { replace: true });
    const slot: LinearSlotRef = { source: 'file', id: WS_A };
    fx.refresher.nameMiss(slot, valueDigestHex(KEY));
    await fx.refresher.idle();
    for (turn = 1; turn < bodies.length; turn += 1) {
      fx.refresher.queueDirectory(slot);
      await fx.refresher.idle();
    }
    statusesMark = fx.refresher.directory.projectStatusesRead(slot, valueDigestHex(KEY));
    return fx.refresher.directory.get(slot, valueDigestHex(KEY));
  }
  const sent: string[] = [];

  it('a refresh reads project statuses', async () => {
    const held = await refreshWith(() => linearRecord('read-initiatives-probe').body);
    expect(sent).toEqual([
      ...LINEAR_DIRECTORY_COLLECTIONS.map((c) => LINEAR_DIRECTORY_DOCUMENTS[c]),
      LINEAR_HIERARCHY_DOCUMENTS.projectStatuses, LINEAR_HIERARCHY_DOCUMENTS.initiativesProbe,
    ]);
    expect(held?.projectStatuses.map((s) => s.type)).toEqual(['planned', 'backlog', 'canceled', 'completed', 'started']);
    expect(statusesMark).toBe('read');
  });

  it("the probe's answer lands in entries.initiatives", async () => {
    expect((await refreshWith(() => linearRecord('read-initiatives-probe').body))?.initiatives).toBe('on');
    expect((await refreshWith(() => ({ data: { initiatives: null } })))?.initiatives).toBe('unknown');
  });

  it('a rate-limited probe keeps the four core collections and `unknown`', async () => {
    const held = await refreshWith(() => RATELIMITED_ERRORS);
    expect(held).not.toBeNull();
    expect(held?.viewerId).toBe(VIEWER);
    expect(held?.initiatives).toBe('unknown');
    expect(held?.projectStatuses).toHaveLength(5);
  });

  // D-8701 (statuses-unread-distinct) changed this wave-2 pin: a first fill whose statuses page failed holds NO statuses and
  // says they were never read, so the plan sync waits for a refill rather than read "no status of that type".
  it('a failed project-statuses page on a first fill keeps the core collections, with no statuses, marked unread (D-8701)', async () => {
    const held = await refreshWith(() => linearRecord('read-initiatives-probe').body, () => ({ data: {} }));
    expect(held).not.toBeNull();
    expect(held?.viewerId).toBe(VIEWER);
    expect(held?.projectStatuses).toEqual([]);
    expect(statusesMark).toBe('unread');
    expect(held?.initiatives).toBe('on');
  });

  it('a failed project-statuses page after a read keeps what was held for this key, its read mark included (D-8701)', async () => {
    const held = await refreshWith(() => linearRecord('read-initiatives-probe').body, () => linearRecord('read-project-statuses').body, () => ({ data: {} }));
    expect(held?.projectStatuses).toHaveLength(5);
    expect(statusesMark).toBe('read');
    const refused = await refreshWith(() => linearRecord('read-initiatives-probe').body, () => linearRecord('read-project-statuses').body, () => RATELIMITED_ERRORS);
    expect(refused?.projectStatuses).toHaveLength(5);
    expect(statusesMark).toBe('read');
  });

  it('an empty statuses page that was read is read, not unread (D-8701: "no status of that type" stays status-missing)', async () => {
    const held = await refreshWith(() => linearRecord('read-initiatives-probe').body, () => ({ data: { projectStatuses: { nodes: [] } } }));
    expect(held?.projectStatuses).toEqual([]);
    expect(statusesMark).toBe('read');
  });
});

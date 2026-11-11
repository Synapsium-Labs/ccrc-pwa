// The directory's status types, unsent until the capture (D-8180, plan task 1.4): the project-status page reader over a
// constructed answer, `statusOfType` (by type, never by name), and the refresher's wave-1 refresh, which still sends
// exactly the four documents it sent before and leaves the new parts empty and `unknown`.
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
import { linearAnswer } from './linearFetchFake.js';
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

describe('the project-status page reader (constructed fixture)', () => {
  it('a directory page of project statuses reads id, name and type', () => {
    const rec = linearRecord('directory-project-statuses-page-1-constructed');
    expect(rec.document).toBe(LINEAR_HIERARCHY_DOCUMENTS.projectStatuses);
    const page = readLinearProjectStatusesPage(rec.body);
    expect(page).toEqual({
      ok: true,
      statuses: [
        { id: '00000000-0008-4000-8000-000000000001', name: 'Backlog', type: 'backlog' },
        { id: '00000000-0008-4000-8000-000000000003', name: 'Started', type: 'started' },
        { id: '00000000-0008-4000-8000-000000000004', name: 'Shipped', type: 'completed' },
        { id: '00000000-0008-4000-8000-000000000005', name: 'Cancelled', type: 'canceled' },
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

describe('the refresher in wave 1', () => {
  it('a wave-1 refresh sends exactly the documents it sent before', async () => {
    const dir = path.join(mkTmp('ccrc-linear-dirh-'), '.ccrc');
    mkdirSync(dir, { recursive: true });
    const sent: string[] = [];
    const conn = (nodes: unknown[]): Record<string, unknown> => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
    const f: FetchLike = async (_u, init) => {
      const q = (JSON.parse(init.body) as { query: string }).query;
      sent.push(q);
      const body = q === LINEAR_DIRECTORY_DOCUMENTS.states ? { data: { workflowStates: conn([]) } }
        : q === LINEAR_DIRECTORY_DOCUMENTS.labels ? { data: { issueLabels: conn([]) } }
        : q === LINEAR_DIRECTORY_DOCUMENTS.projects ? { data: { projects: conn([]) } }
        : { data: { viewer: { id: VIEWER }, users: conn([]) } };
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
    expect(sent).toEqual(LINEAR_DIRECTORY_COLLECTIONS.map((c) => LINEAR_DIRECTORY_DOCUMENTS[c]));
    expect(sent).toHaveLength(4);
    const held = fx.refresher.directory.get(slot, valueDigestHex(KEY));
    expect(held?.projectStatuses).toEqual([]);
    expect(held?.initiatives).toBe('unknown');
  });
});

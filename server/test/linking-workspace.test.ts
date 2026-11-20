// Linear hierarchy wave 8, D-8808 (Task 8.1): a project row that names its workspace resolves its team key there only.
// The owner rule (`teamOwnerProject`) and the plan store's project facts, over a real coord.db. Neutral fixtures only.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { setLinking } from '../src/coord/linkingStore.js';
import { hierarchyProjectsOf, type HierarchyProjectFacts } from '../src/coord/planStore.js';
import { linearOwnerOfTeam, teamOwnerProject } from '../src/coord/planPolicy.js';
import { mkTmp } from './tmpHelpers.js';

const WS_A = '00000000-0000-4000-8000-0000000000a1';
const WS_B = '00000000-0000-4000-8000-0000000000b2';
const facts = (project: string, over: Partial<HierarchyProjectFacts> = {}): HierarchyProjectFacts =>
  ({ project, teamKey: 'AAA', initiatives: 'on', linearOwner: null, ownsTeam: false, order: null, workspaceId: null, ...over });

describe('teamOwnerProject with a workspace', () => {
  const rows = [facts('project-a', { order: 1, workspaceId: WS_A }), facts('project-b', { order: 2, workspaceId: WS_B })];
  it('a shared key held by two projects in two workspaces routes each inbound issue to its own workspace\'s project', () => {
    expect(teamOwnerProject('AAA', rows, WS_A)).toBe('project-a');
    expect(teamOwnerProject('AAA', rows, WS_B)).toBe('project-b');
  });
  it('a holder with no workspace still counts, and no workspace asked reads every holder as before', () => {
    expect(teamOwnerProject('AAA', [facts('project-c', { order: 1 }), ...rows], WS_B)).toBe('project-c');
    expect(teamOwnerProject('AAA', rows)).toBe('project-a');
    expect(teamOwnerProject('AAA', rows, null)).toBe('project-a');
  });
  it('a workspace nobody holds the key in owns nothing', () => {
    expect(teamOwnerProject('AAA', rows, '00000000-0000-4000-8000-0000000000c3')).toBeNull();
  });
});

describe('hierarchyProjectsOf carries the workspace', () => {
  let dir: string;
  let db: ReturnType<typeof openCoordDb>;
  beforeEach(() => { dir = mkTmp('ccrc-linking-ws-'); db = openCoordDb(path.join(dir, 'coord.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  it('a stored pair reads back, and a project with none reads null', () => {
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null, workspace: WS_A }, 'device-1', 1);
    setLinking(db, 'project-b', { teamKey: 'AAA', override: null }, 'device-1', 2);
    const by = new Map(hierarchyProjectsOf(db).map((r) => [r.project, r.workspaceId]));
    expect(by.get('project-a')).toBe(WS_A);
    expect(by.get('project-b')).toBeNull();
  });
});

describe('linearOwnerOfTeam with a workspace', () => {
  const f = { latestProgrammeCoordinator: (p: string) => `coord-of-${p}`, presence: () => 'alive' as const };
  const rows = [facts('project-a', { order: 1, workspaceId: WS_A, linearOwner: 'coord-a' }), facts('project-b', { order: 2, workspaceId: WS_B, linearOwner: 'coord-b' })];
  it("a shared key held by two projects in two workspaces picks each workspace's own project's owner", () => {
    expect(linearOwnerOfTeam('AAA', rows, f, WS_A)).toMatchObject({ project: 'project-a', id: 'coord-a' });
    expect(linearOwnerOfTeam('AAA', rows, f, WS_B)).toMatchObject({ project: 'project-b', id: 'coord-b' });
    expect(linearOwnerOfTeam('AAA', rows, f)).toMatchObject({ project: 'project-a' });
  });
});

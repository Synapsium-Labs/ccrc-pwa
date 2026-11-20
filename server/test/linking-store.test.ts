// D-8147: the `project_linking` table's SQL (`coord/linkingStore.ts`), over a real coord.db.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { linkTeamAuto, linkingAll, linkingOf, recordReading, setLinking } from '../src/coord/linkingStore.js';
import { mkTmp } from './tmpHelpers.js';

let dir: string;
let db: ReturnType<typeof openCoordDb>;

beforeEach(() => {
  dir = mkTmp('ccrc-linking-store-');
  db = openCoordDb(path.join(dir, 'coord.db'));
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const MEASURED = { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: 100 } as const;

describe('project_linking', () => {
  it('a project with no row reads unmeasured with no key and mode unknown', () => {
    expect(linkingOf(db, 'project-a')).toEqual({
      teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: null, teamCandidates: [], teamWorkspace: null,
    });
  });

  it('setLinking writes the key and override and leaves the reading', () => {
    recordReading(db, 'project-a', MEASURED);
    setLinking(db, 'project-a', { teamKey: 'KEY', override: 'public' }, 'device-1', 200);
    expect(linkingOf(db, 'project-a')).toEqual({
      teamKey: 'KEY', override: 'public', measured: MEASURED, mode: 'public', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: { source: 'manual', at: 200 }, teamCandidates: [], teamWorkspace: null,
    });
    const row = db.prepare('SELECT setBy, setAt FROM project_linking WHERE project = ?').get('project-a');
    expect({ ...row }).toEqual({ setBy: 'device-1', setAt: 200 });
  });

  it('recordReading writes the reading and leaves the key', () => {
    setLinking(db, 'project-a', { teamKey: 'KEY', override: null }, 'device-1', 200);
    recordReading(db, 'project-a', MEASURED);
    expect(linkingOf(db, 'project-a')).toEqual({
      teamKey: 'KEY', override: null, measured: MEASURED, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: { source: 'manual', at: 200 }, teamCandidates: [], teamWorkspace: null,
    });
    recordReading(db, 'project-a', { state: 'unmeasured' });
    expect(linkingOf(db, 'project-a').teamKey).toBe('KEY');
    expect(linkingOf(db, 'project-a').measured).toEqual({ state: 'unmeasured' });
  });

  it('a failed reading leaves the mode as the last good reading made it; with no good reading it is unknown', () => {
    recordReading(db, 'project-z', { state: 'failed', reason: 'gh-failed', at: 250 });
    expect(linkingOf(db, 'project-z').mode).toBe('unknown');
    recordReading(db, 'project-a', MEASURED);
    recordReading(db, 'project-a', { state: 'failed', reason: 'gh-failed', at: 300 });
    expect(linkingOf(db, 'project-a')).toEqual({
      teamKey: null, override: null, measured: { state: 'failed', reason: 'gh-failed', at: 300 }, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
      teamLink: null, teamCandidates: [], teamWorkspace: null,
    });
    // The last visibility stays in the row, so the next measurement overwrites it and nothing else has to.
    expect(db.prepare('SELECT visibility FROM project_linking WHERE project = ?').get('project-a')).toEqual({ visibility: 'private' });
    recordReading(db, 'project-a', { ...MEASURED, visibility: 'public', at: 400 });
    expect(linkingOf(db, 'project-a').measured).toMatchObject({ state: 'measured', visibility: 'public', at: 400 });
  });

  it('a failed re-read of a public project stays public', () => {
    recordReading(db, 'project-a', { ...MEASURED, visibility: 'public', at: 350 });
    recordReading(db, 'project-a', { state: 'failed', reason: 'gh-failed', at: 360 });
    expect(linkingOf(db, 'project-a').mode).toBe('public');
  });

  it('linkingAll reads every row in one query', () => {
    setLinking(db, 'project-a', { teamKey: 'KEY', override: null }, 'device-1', 1);
    recordReading(db, 'project-b', MEASURED);
    const all = linkingAll(db);
    expect([...all.keys()].sort()).toEqual(['project-a', 'project-b']);
    expect(all.get('project-b')?.mode).toBe('private');
    expect(all.get('project-a')?.teamKey).toBe('KEY');
  });
});

// Linear hierarchy wave 8, D-8808: the workspace the key resolves in.
describe('project_linking.teamWorkspace', () => {
  const WS = '00000000-0000-4000-8000-0000000000a1';
  const EV = { kind: 'name-match', matched: 'project', on: 'name' } as const;
  it('setLinking writes the workspace beside the key and the wire carries it', () => {
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null, workspace: WS }, 'device-1', 200);
    expect(linkingOf(db, 'project-a').teamWorkspace).toBe(WS);
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null, workspace: null }, 'device-1', 300);
    expect(linkingOf(db, 'project-a').teamWorkspace).toBeNull();
  });
  it('setLinking has one meaning for the workspace: null clears, a string writes, absent leaves it as it is', () => {
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null, workspace: WS }, 'device-1', 1);
    setLinking(db, 'project-a', { teamKey: 'AAA', override: 'private' }, 'device-1', 2);
    expect(linkingOf(db, 'project-a')).toMatchObject({ override: 'private', teamWorkspace: WS });
    setLinking(db, 'project-a', { teamKey: 'AAA', override: 'private', workspace: null }, 'device-1', 3);
    expect(linkingOf(db, 'project-a').teamWorkspace).toBeNull();
  });
  it('a project with no row reads a null workspace', () => {
    expect(linkingOf(db, 'project-none').teamWorkspace).toBeNull();
  });
  it('linkTeamAuto writes its workspace argument, and null when it names none', () => {
    expect(linkTeamAuto(db, 'project-a', { key: 'AAA', name: 'Alpha', evidence: EV, workspace: WS }, 100)).toBe(true);
    expect(linkingOf(db, 'project-a')).toMatchObject({ teamKey: 'AAA', teamWorkspace: WS });
    expect(linkTeamAuto(db, 'project-b', { key: 'BBB', name: 'Beta', evidence: EV, workspace: null }, 100)).toBe(true);
    expect(linkingOf(db, 'project-b').teamWorkspace).toBeNull();
  });
});

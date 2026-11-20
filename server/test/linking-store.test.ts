// D-8147: the `project_linking` table's SQL (`coord/linkingStore.ts`), over a real coord.db.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { linkSourceOf, linkTeamAuto, linkTeamOverlord, linkingAll, linkingOf, recordReading, recordTeamSuggestion, setLinking } from '../src/coord/linkingStore.js';
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

// Linear hierarchy wave 8, D-8808 (Task 8.4): a coordinator's suggestions.
describe('project_linking.teamSuggestions', () => {
  const S = { by: 'lane-a', key: 'AAA', workspaceId: null, workspaceName: null, teamName: 'Alpha', why: 'because', at: 5 };
  const row = (p: string): void => recordReading(db, p, MEASURED);
  const cell = (p: string) => db.prepare('SELECT teamSuggestions FROM project_linking WHERE project = ?').get(p);
  it('writes only where the key is null, in the same statement', () => {
    row('project-a'); row('project-b');
    expect(recordTeamSuggestion(db, 'project-a', S)).toBe('written');
    setLinking(db, 'project-b', { teamKey: 'BBB', override: null }, 'd', 1);
    expect(recordTeamSuggestion(db, 'project-b', S)).toBe('team-set');
    expect(linkingOf(db, 'project-b').teamCandidates).toEqual([]);
    // The key lands after the first suggestion: the statement's own guard refuses.
    db.prepare('UPDATE project_linking SET teamKey = ? WHERE project = ?').run('AAA', 'project-a');
    expect(recordTeamSuggestion(db, 'project-a', { ...S, by: 'lane-b' })).toBe('team-set');
  });
  it('a project with no row is no-project and mints no row', () => {
    expect(recordTeamSuggestion(db, 'project-typo', S)).toBe('no-project');
    expect(linkingAll(db).size).toBe(0);
  });
  it('one per session: a resend replaces, another session adds', () => {
    row('project-a');
    recordTeamSuggestion(db, 'project-a', S);
    recordTeamSuggestion(db, 'project-a', { ...S, why: 'again', at: 6 });
    recordTeamSuggestion(db, 'project-a', { ...S, by: 'lane-b', key: 'BBB', teamName: 'Beta' });
    expect(linkingOf(db, 'project-a').teamCandidates!.map((c) => [c.key, c.evidence])).toEqual([
      ['AAA', { kind: 'suggested', by: 'lane-a', why: 'again' }],
      ['BBB', { kind: 'suggested', by: 'lane-b', why: 'because' }],
    ]);
  });
  it('keeps the newest eight by time, in one transaction with the write', () => {
    row('project-a');
    for (let i = 1; i <= 10; i++) recordTeamSuggestion(db, 'project-a', { ...S, by: `lane-${i}`, at: i });
    const by = linkingOf(db, 'project-a').teamCandidates!.map((c) => (c.evidence as { by: string }).by);
    expect(by).toEqual(['3', '4', '5', '6', '7', '8', '9', '10'].map((n) => `lane-${n}`));
  });
  it('a cell that does not parse reads as none, and a key write clears the cell', () => {
    row('project-a');
    db.prepare("UPDATE project_linking SET teamSuggestions = 'not json' WHERE project = 'project-a'").run();
    expect(linkingOf(db, 'project-a').teamCandidates).toEqual([]);
    recordTeamSuggestion(db, 'project-a', S);
    expect(linkingOf(db, 'project-a').teamCandidates).toHaveLength(1);
    setLinking(db, 'project-a', { teamKey: null, override: null }, 'd', 7);
    expect(linkingOf(db, 'project-a').teamCandidates).toHaveLength(1);
    setLinking(db, 'project-a', { teamKey: 'AAA', override: null }, 'd', 8);
    expect(cell('project-a')).toEqual({ teamSuggestions: null });
  });
  it('linkTeamAuto clears it', () => {
    row('project-a');
    recordTeamSuggestion(db, 'project-a', S);
    expect(linkTeamAuto(db, 'project-a', { key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } }, 9)).toBe(true);
    expect(cell('project-a')).toEqual({ teamSuggestions: null });
  });
});

// Linear hierarchy wave 8, D-8809 (Task 8.5): the Overlord's link, stored as teamSource 'auto' plus the call's id (migration 64's
// CHECK cannot widen without a table rebuild), its source derived by ONE reader, `linkSourceOf`.
describe('project_linking.teamCallId (the Overlord link)', () => {
  const EV = { kind: 'name-match', matched: 'project', on: 'name' } as const;
  const LINK = { key: 'AAA', name: 'Alpha', evidence: EV, workspace: 'ws-a' };
  const CALL = { program: 'linear-sync', madeBy: 'lane-a', build: null, call: {
    class: 'big' as const, runId: null, question: 'q', options: ['a', 'b'], chosen: 'a', why: 'w', reversible: true, wakeOn: null } };
  const stored = (p: string) => db.prepare('SELECT teamSource, teamCallId FROM project_linking WHERE project = ?').get(p);
  const calls = (): number => (db.prepare('SELECT COUNT(*) AS n FROM coordinator_calls').get() as { n: number }).n;
  it('linkSourceOf is the one reader: manual, auto, the overlord when a call id stands beside auto, else null', () => {
    expect(linkSourceOf('manual', null)).toBe('manual');
    expect(linkSourceOf('manual', 7)).toBe('manual');
    expect(linkSourceOf('auto', null)).toBe('auto');
    expect(linkSourceOf('auto', 7)).toBe('overlord');
    expect(linkSourceOf(null, 7)).toBeNull();
    expect(linkSourceOf('other', null)).toBeNull();
  });
  it('links with the call in one transaction: stored auto plus the call id, the wire says overlord', () => {
    recordReading(db, 'project-a', MEASURED);
    const id = linkTeamOverlord(db, 'project-a', LINK, CALL, 100);
    expect(typeof id).toBe('number');
    expect({ ...stored('project-a') }).toEqual({ teamSource: 'auto', teamCallId: id });
    expect(linkingOf(db, 'project-a')).toMatchObject({
      teamKey: 'AAA', teamWorkspace: 'ws-a', teamCandidates: [],
      teamLink: { source: 'overlord', teamName: 'Alpha', evidence: EV, at: 100, callId: id },
    });
    expect(calls()).toBe(1);
  });
  it('the same rule as the automatic link: a key or the operator\'s decision refuses, and the call rolls back', () => {
    setLinking(db, 'project-a', { teamKey: 'BBB', override: null }, 'd', 1);
    setLinking(db, 'project-b', { teamKey: 'BBB', override: null }, 'd', 1);
    setLinking(db, 'project-b', { teamKey: null, override: null }, 'd', 2);
    expect(linkTeamOverlord(db, 'project-a', LINK, CALL, 100)).toBeNull();
    expect(linkTeamOverlord(db, 'project-b', LINK, CALL, 100)).toBeNull();
    expect(calls()).toBe(0);
    expect(linkingOf(db, 'project-a').teamKey).toBe('BBB');
    expect(linkingOf(db, 'project-b')).toMatchObject({ teamKey: null, teamLink: { source: 'manual' } });
  });
  it('the operator\'s write overturns it: the key becomes manual and the call id is cleared', () => {
    const id = linkTeamOverlord(db, 'project-a', LINK, CALL, 100)!;
    setLinking(db, 'project-a', { teamKey: 'AAA', override: 'private' }, 'd', 150);
    expect(linkingOf(db, 'project-a').teamLink).toMatchObject({ source: 'overlord', callId: id });
    setLinking(db, 'project-a', { teamKey: 'BBB', override: null }, 'd', 200);
    expect({ ...stored('project-a') }).toEqual({ teamSource: 'manual', teamCallId: null });
    expect(linkingOf(db, 'project-a').teamLink).toEqual({ source: 'manual', at: 200 });
  });
  it('the automatic link writes no call id, even over a stale one', () => {
    recordReading(db, 'project-a', MEASURED);
    db.prepare('UPDATE project_linking SET teamCallId = 9 WHERE project = ?').run('project-a');
    expect(linkTeamAuto(db, 'project-a', LINK, 100)).toBe(true);
    expect({ ...stored('project-a') }).toEqual({ teamSource: 'auto', teamCallId: null });
    expect(linkingOf(db, 'project-a').teamLink).toEqual({ source: 'auto', teamName: 'Alpha', evidence: EV, at: 100 });
  });
});

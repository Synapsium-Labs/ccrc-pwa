// D-8405: the automatic team link. The decider (`linking/teamLink.ts`, L1) for each evidence class, the store's writers
// (`coord/linkingStore.ts`: the operator's key wins over the pass in the same statement), and the lane's step
// (`linking/visibilityLane.ts#linkTeams`) over a real coord.db and a Linear store read the test hands in. Neutral
// fixtures: `project-a`, team keys `AAA`/`BBB`/`CCC`, `owner/repo`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  TEAM_LINK_MIN_IDS, TEAM_LINK_MIN_SHARE, decideTeamLink, planTeamLink, repoNameOf, teamSourceAfterWrite, ticketTally,
  type KnownTeam, type TeamLinkFacts,
} from '../src/linking/teamLink.js';
import { VisibilityLane } from '../src/linking/visibilityLane.js';
import type { LinearStoreRead } from '../src/linear/store.js';
import { routableTeams } from '../src/linear/route.js';
import { ticketTexts, type CcdPrLine } from '../src/prstate.js';
import { isTeamCandidate, isTeamEvidence } from '../../shared/linking.js';
import { isLinearTeamKey } from '../../shared/linear.js';
import { mkTmp } from './tmpHelpers.js';

const TEAMS: KnownTeam[] = [{ key: 'AAA', name: 'Alpha' }, { key: 'BBB', name: 'Beta' }, { key: 'CCC', name: 'project-a' }];
const facts = (over: Partial<TeamLinkFacts> = {}): TeamLinkFacts => ({
  project: 'project-x', repo: 'repo-x', mode: 'private', teams: TEAMS, tally: new Map(), ...over,
});
const tally = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o));

describe('ticketTally: distinct ids per key, in either case, as whole tokens', () => {
  it('counts one id once whatever its spelling, and keys by the uppercased prefix', () => {
    const t = ticketTally(['ws/aaa-12-fix-login', 'AAA-12: fix login', 'fixes aaa-012 and AAA-13', 'BBB-1', 'xAAA-14', 'AAA-15x']);
    expect(t.get('AAA')).toBe(2);   // 12 and 13; xAAA-14 and AAA-15x are not whole tokens
    expect(t.get('BBB')).toBe(1);
  });

  it('reads the texts of a pull request line: branch, commits and every row title and head branch', () => {
    const line = {
      branch: 'ws/aaa-1-x', commits: [{ sha: 's', subject: 'AAA-2 subject', body: 'body names AAA-3' }],
      rows: [{ title: 'AAA-4: title', headRefName: 'aaa-5-branch' }, { number: 9 }],
    } as unknown as CcdPrLine;
    expect(ticketTally(ticketTexts(line)).get('AAA')).toBe(5);
  });

  it('repoNameOf takes the slug\'s last part', () => {
    expect(repoNameOf('owner/repo')).toBe('repo');
    expect(repoNameOf('repo')).toBe('repo');
  });
});

describe('decideTeamLink: the evidence order (a) ticket ids, (b) name match, (c) none', () => {
  it('(a) links a private project whose ids are decisive: at least 3 and at least 80% of the ids seen', () => {
    expect(TEAM_LINK_MIN_IDS).toBe(3);
    expect(TEAM_LINK_MIN_SHARE).toBe(0.8);
    expect(decideTeamLink(facts({ tally: tally({ AAA: 8, BBB: 2 }) }))).toEqual({
      kind: 'link', key: 'AAA', name: 'Alpha', evidence: { kind: 'ticket-ids', ids: 8, of: 10 },
    });
  });

  it('(a) counts only known team keys: a prefix no team holds is no evidence against', () => {
    expect(decideTeamLink(facts({ tally: tally({ AAA: 3, UTF: 40 }) }))).toMatchObject({ kind: 'link', key: 'AAA' });
  });

  it('(a) below the floor or the share gives candidates, best first, never a link', () => {
    expect(decideTeamLink(facts({ tally: tally({ AAA: 2 }) }))).toEqual({
      kind: 'candidates', candidates: [{ key: 'AAA', name: 'Alpha', evidence: { kind: 'ticket-ids', ids: 2, of: 2 } }],
    });
    expect(decideTeamLink(facts({ tally: tally({ AAA: 7, BBB: 3 }) }))).toEqual({
      kind: 'candidates', candidates: [
        { key: 'AAA', name: 'Alpha', evidence: { kind: 'ticket-ids', ids: 7, of: 10 } },
        { key: 'BBB', name: 'Beta', evidence: { kind: 'ticket-ids', ids: 3, of: 10 } },
      ],
    });
  });

  it('(a) never applies to a public or unmeasured repository: its ids are not read', () => {
    for (const mode of ['public', 'unknown'] as const) {
      expect(decideTeamLink(facts({ mode, tally: tally({ AAA: 9 }) }))).toEqual({ kind: 'candidates', candidates: [] });
    }
  });

  it('(b) links on one exact match of the project name to a team name, ignoring case', () => {
    expect(decideTeamLink(facts({ project: 'PROJECT-A', mode: 'public' }))).toEqual({
      kind: 'link', key: 'CCC', name: 'project-a', evidence: { kind: 'name-match', matched: 'project', on: 'name' },
    });
  });

  it('(b) links on the repository name matching a team key', () => {
    expect(decideTeamLink(facts({ repo: 'bbb', mode: 'unknown' }))).toEqual({
      kind: 'link', key: 'BBB', name: 'Beta', evidence: { kind: 'name-match', matched: 'repo', on: 'key' },
    });
  });

  it('(b) two teams matching give both as candidates, never a link', () => {
    expect(decideTeamLink(facts({ project: 'alpha', repo: 'bbb' }))).toEqual({
      kind: 'candidates', candidates: [
        { key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } },
        { key: 'BBB', name: 'Beta', evidence: { kind: 'name-match', matched: 'repo', on: 'key' } },
      ],
    });
  });

  it('(b) is not decisive against ids of another team: both are offered', () => {
    expect(decideTeamLink(facts({ project: 'alpha', tally: tally({ BBB: 2 }) }))).toEqual({
      kind: 'candidates', candidates: [
        { key: 'BBB', name: 'Beta', evidence: { kind: 'ticket-ids', ids: 2, of: 2 } },
        { key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } },
      ],
    });
    // Ids of the matched team itself, short of (a)'s floor, do not stand in its way.
    expect(decideTeamLink(facts({ project: 'alpha', tally: tally({ AAA: 1 }) }))).toMatchObject({ kind: 'link', key: 'AAA' });
  });

  it('(c) nothing: no link and no candidate; no teams known: the same', () => {
    expect(decideTeamLink(facts())).toEqual({ kind: 'candidates', candidates: [] });
    expect(decideTeamLink(facts({ teams: [], tally: tally({ AAA: 9 }) }))).toEqual({ kind: 'candidates', candidates: [] });
  });

  it('a key two workspaces share is one team to link', () => {
    const teams = [{ key: 'AAA', name: 'Alpha' }, { key: 'aaa', name: 'Alpha elsewhere' }];
    expect(decideTeamLink(facts({ teams, tally: tally({ AAA: 4 }) }))).toMatchObject({ kind: 'link', key: 'AAA', name: 'Alpha' });
  });
});

describe('planTeamLink and teamSourceAfterWrite: the operator\'s key always wins', () => {
  const decisive = facts({ tally: tally({ AAA: 5 }) });
  it('a project with a key keeps no candidates and is never linked', () => {
    expect(planTeamLink({ teamKey: 'BBB', source: 'auto' }, decisive)).toEqual({ link: null, candidates: [] });
    expect(planTeamLink({ teamKey: 'BBB', source: 'manual' }, decisive)).toEqual({ link: null, candidates: [] });
  });

  it('a key the operator cleared is not linked again: the decisive team is offered instead', () => {
    const link = { key: 'AAA', name: 'Alpha', evidence: { kind: 'ticket-ids', ids: 5, of: 5 } };
    expect(planTeamLink({ teamKey: null, source: 'manual' }, decisive)).toEqual({ link: null, candidates: [link] });
    expect(planTeamLink({ teamKey: null, source: null }, decisive)).toEqual({ link, candidates: [link] });
  });

  it('a write that changes the key is the operator\'s; one that sends the stored key back keeps its source', () => {
    expect(teamSourceAfterWrite({ teamKey: 'AAA', source: 'auto' }, 'AAA')).toBe('auto');
    expect(teamSourceAfterWrite({ teamKey: 'AAA', source: 'auto' }, 'BBB')).toBe('manual');
    expect(teamSourceAfterWrite({ teamKey: 'AAA', source: 'auto' }, null)).toBe('manual');
    expect(teamSourceAfterWrite({ teamKey: null, source: null }, null)).toBeNull();
  });
});

describe('the wire guards', () => {
  it('admit exactly the two evidence shapes and a candidate with a key in the team grammar', () => {
    expect(isTeamEvidence({ kind: 'ticket-ids', ids: 3, of: 4 })).toBe(true);
    expect(isTeamEvidence({ kind: 'ticket-ids', ids: 5, of: 4 })).toBe(false);
    expect(isTeamEvidence({ kind: 'name-match', matched: 'repo', on: 'key' })).toBe(true);
    expect(isTeamEvidence({ kind: 'name-match', matched: 'repo', on: 'key', extra: 1 })).toBe(false);
    expect(isTeamEvidence({ kind: 'guess' })).toBe(false);
    const ev = { kind: 'name-match', matched: 'project', on: 'name' };
    expect(isTeamCandidate({ key: 'AAA', name: 'Alpha', evidence: ev }, isLinearTeamKey)).toBe(true);
    expect(isTeamCandidate({ key: 'not a key', name: 'Alpha', evidence: ev }, isLinearTeamKey)).toBe(false);
  });
});

let home: string;
let coord: CoordStore;
beforeEach(() => {
  home = mkTmp('ccrc-team-link-');
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
});
afterEach(() => {
  coord.db.close();
  rmSync(home, { recursive: true, force: true });
});

const EV = { kind: 'ticket-ids', ids: 5, of: 5 } as const;

describe('the store: one writer of the linking row, the operator first', () => {
  it('migration 64 adds the five team columns to project_linking and nothing else', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1]!.replace(/--[^\n]*/g, '').trim();
    expect(last.split(';').map((l) => l.trim()).filter(Boolean)).toEqual([
      "ALTER TABLE project_linking ADD COLUMN teamSource TEXT CHECK (teamSource IN ('manual','auto'))",
      'ALTER TABLE project_linking ADD COLUMN teamName TEXT',
      'ALTER TABLE project_linking ADD COLUMN teamEvidence TEXT',
      'ALTER TABLE project_linking ADD COLUMN teamAt INTEGER',
      'ALTER TABLE project_linking ADD COLUMN teamCandidates TEXT',
    ]);
  });

  it('the pass links a project with no row, and the row says how', () => {
    expect(coord.linkTeamAuto('project-a', { key: 'AAA', name: 'Alpha', evidence: EV }, 100)).toBe(true);
    const l = coord.linkingOf('project-a');
    expect(l.teamKey).toBe('AAA');
    expect(l.teamLink).toEqual({ source: 'auto', teamName: 'Alpha', evidence: EV, at: 100 });
    expect(l.teamCandidates).toEqual([]);
  });

  it('the pass never writes over a key the operator typed, nor over a key the operator cleared', () => {
    coord.setLinking('project-a', { teamKey: 'BBB', override: null }, 'device-1', 50);
    expect(coord.linkTeamAuto('project-a', { key: 'AAA', name: 'Alpha', evidence: EV }, 100)).toBe(false);
    expect(coord.linkingOf('project-a').teamKey).toBe('BBB');
    expect(coord.linkingOf('project-a').teamLink).toEqual({ source: 'manual', at: 50 });
    coord.setLinking('project-a', { teamKey: null, override: null }, 'device-1', 60);
    expect(coord.linkTeamAuto('project-a', { key: 'AAA', name: 'Alpha', evidence: EV }, 100)).toBe(false);
    expect(coord.linkingOf('project-a')).toMatchObject({ teamKey: null, teamLink: { source: 'manual', at: 60 } });
  });

  it('an override change re-sends the key and keeps the automatic link; a new key makes it the operator\'s', () => {
    coord.linkTeamAuto('project-a', { key: 'AAA', name: 'Alpha', evidence: EV }, 100);
    coord.setLinking('project-a', { teamKey: 'AAA', override: 'private' }, 'device-1', 200);
    expect(coord.linkingOf('project-a').teamLink).toEqual({ source: 'auto', teamName: 'Alpha', evidence: EV, at: 100 });
    coord.setLinking('project-a', { teamKey: 'BBB', override: 'private' }, 'device-1', 300);
    expect(coord.linkingOf('project-a')).toMatchObject({ teamKey: 'BBB', teamLink: { source: 'manual', at: 300 } });
  });

  it('a key stored before migration 64 reads as the operator\'s, at its set time', () => {
    coord.db.prepare("INSERT INTO project_linking (project, teamKey, setBy, setAt) VALUES ('project-a', 'AAA', 'd', 7)").run();
    expect(coord.linkingOf('project-a').teamLink).toEqual({ source: 'manual', at: 7 });
  });

  it('candidates round-trip through their guard; a cell that does not parse reads as none', () => {
    const c = [{ key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } } as const];
    coord.recordTeamCandidates('project-a', c);
    expect(coord.linkingOf('project-a').teamCandidates).toEqual(c);
    coord.recordTeamCandidates('project-a', []);
    expect(coord.linkingOf('project-a').teamCandidates).toEqual([]);
    coord.db.prepare("UPDATE project_linking SET teamCandidates = '{oops' WHERE project = 'project-a'").run();
    expect(coord.linkingOf('project-a').teamCandidates).toEqual([]);
    coord.db.prepare(`UPDATE project_linking SET teamCandidates = '[{"key":"AAA"}]' WHERE project = 'project-a'`).run();
    expect(coord.linkingOf('project-a').teamCandidates).toEqual([]);
  });

  it('an automatic row whose evidence does not parse reads as a key, not as an automatic link', () => {
    coord.linkTeamAuto('project-a', { key: 'AAA', name: 'Alpha', evidence: EV }, 100);
    coord.db.prepare("UPDATE project_linking SET teamEvidence = 'nope' WHERE project = 'project-a'").run();
    expect(coord.linkingOf('project-a').teamLink).toMatchObject({ source: 'manual' });
  });
});

/** A Linear store read with one file slot whose record describes the key now in its file. */
const storeWith = (teams: { key: string; name: string }[]): LinearStoreRead => ({
  kind: 'listed',
  slots: [{
    source: 'file', id: '00000000-0000-4000-8000-000000000001',
    key: { kind: 'key', digest: 'd1' },
    record: { kind: 'details', details: { keyDigest: 'd1', teams: teams.map((t, i) => ({ id: `t${i}`, ...t })) } },
  }],
  legacy: null,
} as unknown as LinearStoreRead);

describe('the lane: linkTeams over a real coord.db', () => {
  const lane = (store: LinearStoreRead | null) => new VisibilityLane(
    () => ({ coord, runCcd: async () => { throw new Error('the team link calls no ccd'); }, fleetState: undefined, cfg: { ccrcDir: home } }),
    async () => store ?? { kind: 'unreadable', code: 'EACCES' },
  );
  const inputs = (tallies: Record<string, Record<string, number>>, slugs: Record<string, string> = {}) => ({
    tally: (p: string) => tally(tallies[p] ?? {}),
    slug: (p: string) => slugs[p] ?? null,
  });
  const TEAM_STORE = storeWith([{ key: 'AAA', name: 'Alpha' }, { key: 'BBB', name: 'Beta' }]);
  const privateRow = (p: string): void => coord.recordLinkingReading(p, { state: 'measured', visibility: 'private', slug: `owner/${p}`, template: 'present', at: 1 });

  it('routableTeams reads the slot\'s teams while its record describes the key in its file', () => {
    expect(routableTeams(TEAM_STORE as Extract<LinearStoreRead, { kind: 'listed' }>)).toEqual([{ key: 'AAA', name: 'Alpha' }, { key: 'BBB', name: 'Beta' }]);
  });

  it('links a private project on decisive ids, offers candidates for an ambiguous one, and leaves a typed key alone', async () => {
    for (const p of ['project-a', 'project-b', 'project-c']) privateRow(p);
    coord.setLinking('project-c', { teamKey: 'BBB', override: null }, 'device-1', 5);
    await lane(TEAM_STORE).linkTeams(['project-a', 'project-b', 'project-c'], 1000, inputs({
      'project-a': { AAA: 6 }, 'project-b': { AAA: 3, BBB: 3 }, 'project-c': { AAA: 9 },
    }));
    expect(coord.linkingOf('project-a')).toMatchObject({
      teamKey: 'AAA', teamLink: { source: 'auto', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 6, of: 6 }, at: 1000 },
    });
    expect(coord.linkingOf('project-b')).toMatchObject({ teamKey: null, teamLink: null });
    expect(coord.linkingOf('project-b').teamCandidates!.map((c) => c.key)).toEqual(['AAA', 'BBB']);
    expect(coord.linkingOf('project-c')).toMatchObject({ teamKey: 'BBB', teamLink: { source: 'manual', at: 5 }, teamCandidates: [] });
  });

  it('links a project with no row on its repository\'s name (the PR sweep\'s slug), and a second pass changes nothing', async () => {
    await lane(TEAM_STORE).linkTeams(['project-z'], 1000, inputs({}, { 'project-z': 'owner/beta' }));
    expect(coord.linkingOf('project-z')).toMatchObject({ teamKey: 'BBB', teamLink: { source: 'auto', evidence: { kind: 'name-match', matched: 'repo', on: 'name' } } });
    await lane(TEAM_STORE).linkTeams(['project-z'], 2000, inputs({}, { 'project-z': 'owner/alpha' }));
    expect(coord.linkingOf('project-z')).toMatchObject({ teamKey: 'BBB', teamLink: { at: 1000 } });
  });

  it('an unreadable Linear store links nothing and clears nothing', async () => {
    coord.recordTeamCandidates('project-a', [{ key: 'AAA', name: 'Alpha', evidence: EV }]);
    await lane(null).linkTeams(['project-a'], 1000, inputs({ 'project-a': { AAA: 9 } }));
    expect(coord.linkingOf('project-a')).toMatchObject({ teamKey: null, teamCandidates: [{ key: 'AAA' }] });
  });
});

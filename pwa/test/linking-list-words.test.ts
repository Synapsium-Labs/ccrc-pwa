// The compact Project linking list's deciders (D-8932): which kind a row is, why it waits for the
// operator, what its one line says, and how a coordinator select is offered. Pure: rows in, words out. The card
// (`ProjectLinkingCard.tsx`) draws these answers and decides nothing, so each rule is held here.
// Neutral fixtures: `project-a`, `AAA`, `coord-a`, `ws-a`.
import { describe, expect, it } from 'vitest';
import type { ProjectRow } from '../../shared/api';
import type { LinearWorkspaceShown } from '../../shared/linear';
import type { ProjectLinkingWire } from '../../shared/linking';
import type { HierarchyProjectRow } from '../../shared/plan';
import {
  COORDINATOR_SHORT_LIST, HIERARCHY_TEXT, NOT_LIVE_WORDS, coordinatorChoices, inboundShortWords, inboundUnowned, inboundUnownedWords, mapWaitingWords,
  ownerShortWords, owningUnchosen, owningUnchosenWords,
} from '../src/fleet/hierarchyWords';
import {
  LINKING_ROW_WORDS, keyNeedsWorkspace, liftedControls, linkedHowWords, linkedTeamName, linkingCountsWords, linkingDecisions, linkingList, linkingRowKind,
  linkingSummary, templateOffered, unlinkedGroupOpenAtFirst, unlinkedGroupWords,
} from '../src/fleet/linkingWords';

const NOW = Date.UTC(2026, 10, 22, 12);
const wire = (over: Partial<ProjectLinkingWire> = {}): ProjectLinkingWire => ({
  teamKey: null, override: null, measured: { state: 'unmeasured' }, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false, ...over,
});
const ws = (id: string, name: string, teams: Array<[string, string]>): LinearWorkspaceShown =>
  ({ id, name, urlKey: null, user: null, teams: teams.map(([key, n]) => ({ key, name: n })), keyTail: null, checkedAt: null });
const hrow = (project: string, over: Partial<HierarchyProjectRow> = {}): HierarchyProjectRow => ({
  project, teamKey: 'AAA', initiatives: 'on', linearOwner: null, ownerNow: { id: 'coord-a', source: 'default', live: true },
  ownsTeam: false, state: 'not-migrated', stateAt: null, itemId: null, inboundWaiting: 0, ...over,
});
const row = (name: string, linking?: ProjectLinkingWire): ProjectRow => ({ name, workdir: `/w/${name}`, ...(linking === undefined ? {} : { linking }) });
const candidate = (key: string, name: string) => ({ key, name, evidence: { kind: 'name-match', matched: 'project', on: 'name' } as const });
const AUTO = { source: 'auto', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 12, of: 12 }, at: NOW } as const;

describe('the team a row is linked to', () => {
  it('an automatic or an Overlord link carries the team name', () => {
    expect(linkedTeamName(wire({ teamKey: 'AAA', teamLink: AUTO }), null)).toBe('Alpha');
    expect(linkedTeamName(wire({ teamKey: 'AAA', teamLink: { ...AUTO, source: 'overlord', callId: 7 } }), null)).toBe('Alpha');
  });
  it('a key set by hand is looked up in the connected workspaces, in the stored workspace when one is stored', () => {
    const read = [ws('id-a', 'ws-a', [['AAA', 'Alpha']]), ws('id-b', 'ws-b', [['AAA', 'Other']])];
    const manual = { source: 'manual', at: NOW } as const;
    expect(linkedTeamName(wire({ teamKey: 'aaa', teamLink: manual }), [read[0]!])).toBe('Alpha');
    expect(linkedTeamName(wire({ teamKey: 'AAA', teamLink: manual, teamWorkspace: 'id-b' }), read)).toBe('Other');
  });
  it('says no name rather than guess: two workspaces that disagree, an unread list, a key no workspace holds, no key', () => {
    const read = [ws('id-a', 'ws-a', [['AAA', 'Alpha']]), ws('id-b', 'ws-b', [['AAA', 'Other']])];
    expect(linkedTeamName(wire({ teamKey: 'AAA' }), read)).toBeNull();
    expect(linkedTeamName(wire({ teamKey: 'AAA' }), null)).toBeNull();
    expect(linkedTeamName(wire({ teamKey: 'ZZZ' }), read)).toBeNull();
    expect(linkedTeamName(wire(), read)).toBeNull();
  });
  it('how it was linked, in a few words; nothing with no key or from an older server', () => {
    expect(linkedHowWords(wire({ teamKey: 'AAA', teamLink: AUTO }))).toBe(LINKING_ROW_WORDS.auto);
    expect(linkedHowWords(wire({ teamKey: 'AAA', teamLink: { ...AUTO, source: 'overlord', callId: 7 } }))).toBe(LINKING_ROW_WORDS.overlord);
    expect(linkedHowWords(wire({ teamKey: 'AAA', teamLink: { source: 'manual', at: null } }))).toBe(LINKING_ROW_WORDS.manual);
    expect(linkedHowWords(wire({ teamKey: 'AAA' }))).toBeNull();
    expect(linkedHowWords(wire({ teamKey: null, teamLink: { source: 'manual', at: NOW } }))).toBeNull();
  });
});

describe('why a row waits for the operator', () => {
  const two = [ws('id-a', 'ws-a', [['AAA', 'Alpha']]), ws('id-b', 'ws-b', [['AAA', 'Alpha']])];
  it('nothing waits on a linked row with one workspace, its own owner and no map', () => {
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }), [two[0]!], [hrow('project-a')])).toEqual([]);
  });
  it('a suggested team waits: one is named, several are counted', () => {
    const one = linkingDecisions('project-a', wire({ teamCandidates: [candidate('AAA', 'Alpha')] }), null, null);
    expect(one).toEqual([{ kind: 'suggested', control: 'key', words: 'Team AAA (Alpha) is suggested for this project. Link it, or type another key.' }]);
    const many = linkingDecisions('project-a', wire({ teamCandidates: [candidate('AAA', 'Alpha'), candidate('BBB', 'Beta')] }), null, null);
    expect(many).toEqual([{ kind: 'suggested', control: 'key', words: '2 teams are suggested for this project. Link one, or type another key.' }]);
    // A row with a key offers no candidate (`candidatesShown`), so none waits.
    expect(linkingDecisions('project-a', wire({ teamKey: 'CCC', teamCandidates: [candidate('AAA', 'Alpha')] }), null, null)).toEqual([]);
  });
  it('a key two connected workspaces hold waits until one is stored', () => {
    const l = wire({ teamKey: 'AAA', teamWorkspace: null });
    expect(keyNeedsWorkspace(l, two)).toBe(true);
    expect(linkingDecisions('project-a', l, two, null)).toEqual([
      { kind: 'workspace', control: 'key', words: 'Team key AAA exists in more than one Linear workspace. Choose its workspace, then Save.' },
    ]);
    expect(keyNeedsWorkspace(wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }), two), 'a stored workspace settles it').toBe(false);
    expect(keyNeedsWorkspace(wire({ teamKey: 'AAA', teamWorkspace: 'id-gone' }), two), 'a stored one that no longer holds the key does not').toBe(true);
    expect(keyNeedsWorkspace(l, [two[0]!]), 'one holder').toBe(false);
    expect(keyNeedsWorkspace(l, null), 'an unread list is no list').toBe(false);
    expect(keyNeedsWorkspace(wire({ teamKey: 'AAA' }), two), 'an older server could not store the answer, so it is not asked').toBe(false);
  });
  it('a key two projects share waits while neither is its owning project, and says what the box does meanwhile', () => {
    const rows = [hrow('project-a'), hrow('project-b', { teamKey: 'aaa' }), hrow('project-c', { teamKey: 'BBB' })];
    expect(owningUnchosen('project-a', rows)).toEqual({ key: 'AAA', others: ['project-b'] });
    expect(owningUnchosen('project-c', rows)).toBeNull();
    expect(owningUnchosen('project-z', rows)).toBeNull();
    const chosen = [hrow('project-a'), hrow('project-b', { ownsTeam: true })];
    expect(owningUnchosen('project-a', chosen), 'one is chosen: neither row waits').toBeNull();
    expect(owningUnchosen('project-b', chosen)).toBeNull();
    const words = owningUnchosenWords({ key: 'AAA', others: ['project-b'] });
    expect(words).toBe(`Team key AAA is also used by project-b, and no project is chosen as its owning project. Until one is, the project that set the key first owns it. Tick ${HIERARCHY_TEXT.owning} on the one that should.`);
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA' }), null, rows)).toEqual([{ kind: 'owning', control: 'owning', words }]);
  });
  it('two projects that hold one key in two different Linear workspaces hold two teams: neither waits', () => {
    // The server's owner rule is per workspace (`planPolicy.ts` `teamOwnerProject`): a holder pinned to another workspace never competes.
    const rows = [hrow('project-a'), hrow('project-b'), hrow('project-c')];
    const apart = new Map<string, string | null>([['project-a', 'id-a'], ['project-b', 'id-b']]);
    expect(owningUnchosen('project-a', rows.slice(0, 2), apart)).toBeNull();
    expect(owningUnchosen('project-b', rows.slice(0, 2), apart)).toBeNull();
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }), null, rows.slice(0, 2), apart)).toEqual([]);
    // The same workspace, or a holder with none stored, can be the same team: those still share.
    const same = new Map<string, string | null>([['project-a', 'id-a'], ['project-b', 'id-a']]);
    expect(owningUnchosen('project-a', rows.slice(0, 2), same)).toEqual({ key: 'AAA', others: ['project-b'] });
    const mixed = new Map<string, string | null>([['project-a', 'id-a'], ['project-b', 'id-b'], ['project-c', null]]);
    expect(owningUnchosen('project-a', rows, mixed)).toEqual({ key: 'AAA', others: ['project-c'] });
    expect(owningUnchosen('project-c', rows, mixed)).toEqual({ key: 'AAA', others: ['project-a', 'project-b'] });
    // An owning project in another workspace settles nothing here.
    const owned = [hrow('project-a'), hrow('project-b', { ownsTeam: true }), hrow('project-c')];
    expect(owningUnchosen('project-a', owned, mixed)).toEqual({ key: 'AAA', others: ['project-c'] });
    // The list hands every row's stored workspace to the decision.
    const list = linkingList([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' })), row('project-b', wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }))],
      null, rows.slice(0, 2));
    expect(list.listed.map((r) => [r.name, r.kind])).toEqual([['project-a', 'linked'], ['project-b', 'linked']]);
  });
  it('a map waiting for approval waits', () => {
    const rows = [hrow('project-a', { state: 'map-waiting', itemId: 4 })];
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA' }), null, rows)).toEqual([{ kind: 'map', control: 'map', words: mapWaitingWords('AAA') }]);
    expect(mapWaitingWords('AAA')).toBe('A map of how team AAA fits the plan waits for your approval.');
    expect(mapWaitingWords(null)).toBe('A map of how this team fits the plan waits for your approval.');
    for (const state of ['not-migrated', 'migrating', 'migrated', 'put-back', 'unmeasured'] as const) {
      expect(linkingDecisions('project-a', wire({ teamKey: 'AAA' }), null, [hrow('project-a', { state })]), state).toEqual([]);
    }
  });
  it('inbound issues with no live owner wait: the owner is the control; a live owner, an owner from another project and an unmeasured one do not', () => {
    const none = { id: null, source: 'none', live: false } as const;
    const gone = { id: 'coord-b', source: 'named', live: false } as const;
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 2, ownerNow: none }))).toBe(2);
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 1, ownerNow: gone }))).toBe(1);
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 2 })), 'a live owner takes them').toBeNull();
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 0, ownerNow: none })), 'nothing waits').toBeNull();
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 2, ownerNow: { ...none, unmeasured: true } })), 'not measured is not "none"').toBeNull();
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 2, ownerNow: { ...none, project: 'project-b' } })), "the owner is another project's to set").toBeNull();
    expect(inboundUnowned(hrow('project-a', { inboundWaiting: 2, ownerNow: none, teamKey: null }))).toBeNull();
    expect(inboundUnownedWords(1)).toBe('1 inbound issue waits for an owner, and this project has no live Linear owner. Choose a live coordinator as its Linear owner.');
    expect(inboundUnownedWords(2)).toBe('2 inbound issues wait for an owner, and this project has no live Linear owner. Choose a live coordinator as its Linear owner.');
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA' }), null, [hrow('project-a', { inboundWaiting: 2, ownerNow: none })]))
      .toEqual([{ kind: 'inbound', control: 'owner', words: inboundUnownedWords(2) }]);
    expect(linkingDecisions('project-a', wire({ teamKey: 'AAA' }), null, [hrow('project-a', { inboundWaiting: 2 })])).toEqual([]);
  });
  it('with no hierarchy answer its three reasons are not said; several reasons keep their order', () => {
    const rows = [hrow('project-a', { state: 'map-waiting', inboundWaiting: 1, ownerNow: { id: null, source: 'none', live: false } }), hrow('project-b')];
    const l = wire({ teamKey: 'AAA', teamWorkspace: null });
    expect(linkingDecisions('project-a', l, two, null).map((d) => d.kind)).toEqual(['workspace']);
    expect(linkingDecisions('project-a', l, two, rows).map((d) => d.kind)).toEqual(['workspace', 'owning', 'map', 'inbound']);
  });
  it('each reason names the one control that settles it, and a row keeps the controls it drew while it stays open', () => {
    const rows = [hrow('project-a', { state: 'map-waiting', inboundWaiting: 1, ownerNow: { id: null, source: 'none', live: false } }), hrow('project-b')];
    const ds = linkingDecisions('project-a', wire({ teamKey: 'AAA', teamWorkspace: null }), two, rows);
    expect(ds.map((d) => [d.kind, d.control])).toEqual([['workspace', 'key'], ['owning', 'owning'], ['map', 'map'], ['inbound', 'owner']]);
    expect(liftedControls([], ds)).toEqual(['key', 'owning', 'map', 'owner']);
    // A reason that went leaves its control where it was drawn; a new one is added after it; none is doubled.
    expect(liftedControls(['owning'], [])).toEqual(['owning']);
    expect(liftedControls(['owning'], ds.slice(0, 2))).toEqual(['owning', 'key']);
    expect(liftedControls([], [])).toEqual([]);
  });
});

describe('where a row is drawn', () => {
  it('a row that waits is a decision row, with or without a key; else its key decides', () => {
    const waits = [{ kind: 'suggested' as const, control: 'key' as const, words: 'w' }];
    expect(linkingRowKind(wire(), waits)).toBe('decision');
    expect(linkingRowKind(wire({ teamKey: 'AAA' }), waits)).toBe('decision');
    expect(linkingRowKind(wire({ teamKey: 'AAA' }), [])).toBe('linked');
    expect(linkingRowKind(wire(), [])).toBe('unlinked');
    expect(linkingRowKind(wire({ teamLink: { source: 'manual', at: NOW } }), []), 'a key the operator cleared').toBe('unlinked');
  });
  it('the list: the rows that wait first, then the linked ones, each in the route order, then the unlinked ones; one row per project name', () => {
    const cell = wire({ teamKey: 'AAA', teamLink: AUTO });
    const list = linkingList([
      row('project-a'),                                                    // no cell (an older server): not drawn
      row('project-b', wire()),
      row('project-c', cell),
      row('project-c', wire()),                                            // a second checkout of project-c: the first cell wins
      row('project-d', wire({ teamCandidates: [candidate('DDD', 'Delta')] })),
      row('project-e', wire()),
    ], null, null);
    expect(list.listed.map((r) => [r.name, r.kind])).toEqual([['project-d', 'decision'], ['project-c', 'linked']]);
    expect(list.unlinked.map((r) => r.name)).toEqual(['project-b', 'project-e']);
    expect(list.listed[1]!.linking, 'the cell is passed through, not copied').toBe(cell);
    expect(list.listed[0]!.decisions.map((d) => d.kind)).toEqual(['suggested']);
    expect(list.counts).toEqual({ decisions: 1, linked: 1, unlinked: 2 });
  });
  it('a row that waited while the page was open keeps its place among the first rows once it is settled', () => {
    const rows = [row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire({ teamCandidates: [candidate('CCC', 'Gamma')] })), row('project-d', wire())];
    expect(linkingList(rows, null, null).listed.map((r) => r.name)).toEqual(['project-c', 'project-a', 'project-b']);
    // project-b waited and was settled: it stays with the rows that wait, in the route order, and counts as linked.
    const held = linkingList(rows, null, null, new Set(['project-b', 'project-d']));
    expect(held.listed.map((r) => [r.name, r.kind])).toEqual([['project-b', 'linked'], ['project-c', 'decision'], ['project-a', 'linked']]);
    expect(held.unlinked.map((r) => r.name), 'a row with no team is in the group, held or not').toEqual(['project-d']);
    expect(held.counts).toEqual({ decisions: 1, linked: 2, unlinked: 1 });
  });
  it('the counts are said once, at the head: only the kinds that have rows', () => {
    expect(linkingCountsWords({ decisions: 3, linked: 6, unlinked: 21 })).toBe('3 need a decision · 6 linked · 21 not linked');
    expect(linkingCountsWords({ decisions: 1, linked: 1, unlinked: 1 })).toBe('1 needs a decision · 1 linked · 1 not linked');
    expect(linkingCountsWords({ decisions: 0, linked: 4, unlinked: 0 })).toBe('4 linked');
    expect(linkingCountsWords({ decisions: 0, linked: 0, unlinked: 0 })).toBeNull();
  });
  it('the group counts its projects, and starts open only when it is the whole card', () => {
    expect(unlinkedGroupWords(1)).toBe('1 project not linked to Linear');
    expect(unlinkedGroupWords(12)).toBe('12 projects not linked to Linear');
    expect(unlinkedGroupOpenAtFirst(0)).toBe(true);
    expect(unlinkedGroupOpenAtFirst(1)).toBe(false);
  });
});

describe("a listed row's one line", () => {
  it('the team by key and name, how it was linked, the owner and the migration state', () => {
    const s = linkingSummary('project-a', wire({ teamKey: 'AAA', teamLink: AUTO }), null, [hrow('project-a')]);
    expect(s).toEqual({ team: 'AAA · Alpha, linked automatically', owner: 'owner: coord-a', state: 'Not migrated', notes: ['visibility not read'] });
  });
  it('the notes say only what differs from a quiet row: inbound issues, a public or unread repository, a missing template', () => {
    const quiet = { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'present', at: NOW } as const;
    const notes = (l: ProjectLinkingWire, h: HierarchyProjectRow = hrow('project-a')): string[] => linkingSummary('project-a', l, null, [h]).notes;
    expect(notes(wire({ teamKey: 'AAA', mode: 'private', measured: quiet })), 'a private repository with its template').toEqual([]);
    expect(notes(wire({ teamKey: 'AAA', mode: 'private', measured: quiet }), hrow('project-a', { inboundWaiting: 2 }))).toEqual(['2 inbound issues waiting']);
    expect(inboundShortWords(1)).toBe('1 inbound issue waiting');
    expect(inboundShortWords(0)).toBeNull();
    expect(notes(wire({ teamKey: 'AAA', mode: 'public', measured: { ...quiet, visibility: 'public' } }))).toEqual([LINKING_ROW_WORDS.public]);
    expect(notes(wire({ teamKey: 'AAA', mode: 'private', measured: { ...quiet, template: 'absent' } }))).toEqual([LINKING_ROW_WORDS.noTemplate]);
    expect(notes(wire({ teamKey: 'AAA', mode: 'unknown', measured: { state: 'failed', reason: 'offline', at: NOW } }))).toEqual([LINKING_ROW_WORDS.notRead]);
    // An override decides the mode over an unread repository, so the line says the mode, not that it is unread.
    expect(notes(wire({ teamKey: 'AAA', mode: 'public', override: 'public', measured: { state: 'unmeasured' } }))).toEqual([LINKING_ROW_WORDS.public]);
    expect(notes(wire({ teamKey: 'AAA', mode: 'private', measured: { ...quiet, template: 'absent' } }), hrow('project-a', { inboundWaiting: 1 })))
      .toEqual(['1 inbound issue waiting', LINKING_ROW_WORDS.noTemplate]);
    expect([LINKING_ROW_WORDS.public, LINKING_ROW_WORDS.noTemplate, LINKING_ROW_WORDS.notRead]).toEqual(['public', 'no PR template', 'visibility not read']);
    // With no hierarchy answer the inbound count is not known, and is not said.
    expect(linkingSummary('project-a', wire({ teamKey: 'AAA', mode: 'private', measured: quiet }), null, null).notes).toEqual([]);
  });
  it('the template pull request is offered for a private project with a key, a reading and no template', () => {
    const absent = { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW } as const;
    expect(templateOffered(wire({ teamKey: 'AAA', mode: 'private', measured: absent }))).toBe(true);
    expect(templateOffered(wire({ teamKey: null, mode: 'private', measured: absent }))).toBe(false);
    expect(templateOffered(wire({ teamKey: 'AAA', mode: 'public', measured: absent }))).toBe(false);
    expect(templateOffered(wire({ teamKey: 'AAA', mode: 'private', measured: { ...absent, template: 'present' } }))).toBe(false);
    expect(templateOffered(wire({ teamKey: 'AAA', mode: 'unknown', measured: { state: 'unmeasured' } }))).toBe(false);
  });
  it('a key with no known name is the key alone; an older server says no more than it knows', () => {
    expect(linkingSummary('project-a', wire({ teamKey: 'AAA', teamLink: { source: 'manual', at: NOW } }), null, null))
      .toEqual({ team: 'AAA, set by hand', owner: null, state: null, notes: ['visibility not read'] });
    expect(linkingSummary('project-a', wire({ teamKey: 'AAA' }), null, null)).toEqual({ team: 'AAA', owner: null, state: null, notes: ['visibility not read'] });
  });
  it('a row with no key (one that waits on a suggested team) says it is not linked and names no owner or state', () => {
    expect(linkingSummary('project-a', wire(), null, [hrow('project-a', { teamKey: null })]))
      .toEqual({ team: LINKING_ROW_WORDS.notLinked, owner: null, state: null, notes: [] });
  });
  it('the owner, in a few words: live, named but not live, none, not measured', () => {
    expect(ownerShortWords(hrow('project-a'))).toBe('owner: coord-a');
    expect(ownerShortWords(hrow('project-a', { ownerNow: { id: 'coord-b', source: 'named', live: false } }))).toBe('owner: coord-b (not live)');
    // One word for it, the one the select beside it uses ("Default: none live", "(not live)").
    expect(ownerShortWords(hrow('project-a', { ownerNow: { id: null, source: 'none', live: false } }))).toBe('no live owner');
    expect(ownerShortWords(hrow('project-a', { ownerNow: { id: 'coord-a', source: 'default', live: true, unmeasured: true } }))).toBe('owner not measured');
  });
});

describe('a coordinator select', () => {
  const list = [{ id: 'coord-a', live: true }, { id: 'coord-b', live: false }, { id: 'coord-c', live: true }, { id: 'coord-d', live: false }];
  const unlisted = (id: string): string => `${id} (gone)`;
  it('offers the live coordinators, and counts the rest without listing them', () => {
    expect(coordinatorChoices(list, null, false, unlisted)).toEqual({
      selected: null,
      live: [{ id: 'coord-a', words: 'coord-a' }, { id: 'coord-c', words: 'coord-c' }],
      notLive: [], more: NOT_LIVE_WORDS.show(2),
    });
  });
  it('lists the rest, in a group of their own, once they are asked for', () => {
    const c = coordinatorChoices(list, null, true, unlisted);
    expect(c.notLive).toEqual([{ id: 'coord-b', words: 'coord-b (not live)' }, { id: 'coord-d', words: 'coord-d (not live)' }]);
    expect(c.live.map((o) => o.id)).toEqual(['coord-a', 'coord-c']);
    expect(c.more).toBe(NOT_LIVE_WORDS.hide);
  });
  it('always holds the stored choice: a hidden one and an unlisted one are options of their own; an offered one is not doubled', () => {
    expect(coordinatorChoices(list, 'coord-b', false, unlisted).selected).toEqual({ id: 'coord-b', words: 'coord-b (not live)' });
    expect(coordinatorChoices(list, 'coord-z', false, unlisted).selected).toEqual({ id: 'coord-z', words: 'coord-z (gone)' });
    expect(coordinatorChoices(list, 'coord-z', true, unlisted).selected).toEqual({ id: 'coord-z', words: 'coord-z (gone)' });
    expect(coordinatorChoices(list, 'coord-a', false, unlisted).selected).toBeNull();
    expect(coordinatorChoices(list, 'coord-b', true, unlisted).selected).toBeNull();
  });
  it('with nothing behind the control there is no control', () => {
    expect(coordinatorChoices([{ id: 'coord-a', live: true }], null, false, unlisted).more).toBeNull();
    expect(coordinatorChoices([], null, false, unlisted).more).toBeNull();
  });
  it('the control that shows them counts them', () => {
    expect(NOT_LIVE_WORDS.show(1)).toBe('Show 1 coordinator that is not live');
    expect(NOT_LIVE_WORDS.show(23)).toBe('Show 23 coordinators that are not live');
    expect(NOT_LIVE_WORDS.showAll(28)).toBe('Show all 28 coordinators');
  });
  it('a fleet with many live coordinators is no wall: past the short list none is listed until asked for, and the stored one stays', () => {
    const live = (n: number): Array<{ id: string; live: boolean }> => Array.from({ length: n }, (_, i) => ({ id: `coord-${String(i + 1).padStart(2, '0')}`, live: true }));
    const gone = [{ id: 'coord-x', live: false }, { id: 'coord-y', live: false }];
    // At the short list's length every live one is still offered.
    const atCap = coordinatorChoices([...live(COORDINATOR_SHORT_LIST), ...gone], null, false, unlisted);
    expect(atCap.live).toHaveLength(COORDINATOR_SHORT_LIST);
    expect(atCap.more).toBe(NOT_LIVE_WORDS.show(2));
    // One more, and the select holds only what is stored; the control then shows every coordinator.
    const many = [...live(COORDINATOR_SHORT_LIST + 1), ...gone];
    const shut = coordinatorChoices(many, 'coord-03', false, unlisted);
    expect(shut.live).toEqual([]);
    expect(shut.notLive).toEqual([]);
    expect(shut.selected).toEqual({ id: 'coord-03', words: 'coord-03' });
    expect(shut.more).toBe(NOT_LIVE_WORDS.showAll(COORDINATOR_SHORT_LIST + 3));
    expect(coordinatorChoices(many, null, false, unlisted).selected).toBeNull();
    const open = coordinatorChoices(many, 'coord-03', true, unlisted);
    expect(open.live).toHaveLength(COORDINATOR_SHORT_LIST + 1);
    expect(open.notLive.map((o) => o.id)).toEqual(['coord-x', 'coord-y']);
    expect(open.selected, 'offered in the list, so not doubled').toBeNull();
    expect(open.more).toBe(NOT_LIVE_WORDS.fewer);
    expect(COORDINATOR_SHORT_LIST).toBe(8);
  });
});

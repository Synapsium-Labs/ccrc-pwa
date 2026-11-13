// D-8180 (Linear hierarchy plan, Task 1.1): the hierarchy documents and the ccrc operation rows. Inert until wave 3.
// Every answer here is a constructed fixture (`fixtures/linear/*-constructed.json`); nothing reaches a network.
import { describe, expect, it } from 'vitest';
import {
  LINEAR_CCRC_PROVENANCE_LINE, LINEAR_DOCUMENTS, LINEAR_HIERARCHY_DOCUMENTS, isLinearIdentifier, readLinearProjectStatusesPage,
} from '../src/linear/ops.js';
import { isLinearTeamKey } from '../../shared/linear.js';
import {
  LINEAR_CCRC_JOURNAL_OPS, LINEAR_CCRC_OPS, readInitiativesProbe, withCcrcProvenance, type CcrcOpName,
} from '../src/linear/hierarchyOps.js';
import { RATELIMITED_ERRORS } from './linearFetchFake.js';
import { linearRecord } from './linearRecorded.js';

/** Each row's fixture: a constructed hierarchy answer, or the recorded answer of the issue row it reuses. */
const FIXTURE: Readonly<Record<CcrcOpName, string>> = {
  initiativeById: 'read-initiative-by-id-constructed', projectById: 'read-project-by-id-constructed',
  projectStatuses: 'read-project-statuses-constructed', initiativesProbe: 'read-initiatives-probe-constructed',
  initiativesByName: 'read-initiatives-by-name-constructed', projectsByName: 'read-projects-by-name-constructed',
  changedInitiatives: 'read-changed-initiatives-constructed', changedProjects: 'read-changed-projects-constructed',
  changedMilestones: 'read-changed-milestones-constructed', changedIssues: 'read-changed-issues-constructed',
  teamOpenIssues: 'read-team-open-issues-constructed', issueOwned: 'read-issue-owned-constructed',
  initiativeCreate: 'mutation-initiative-create-constructed', initiativeUpdate: 'mutation-initiative-update-constructed',
  initiativeToProjectCreate: 'mutation-initiative-to-project-create-constructed',
  initiativeToProjectDelete: 'mutation-initiative-to-project-delete-constructed',
  projectCreate: 'mutation-project-create-constructed', projectUpdate: 'mutation-project-update-constructed',
  projectMilestoneCreate: 'mutation-project-milestone-create-constructed',
  projectMilestoneUpdate: 'mutation-project-milestone-update-constructed',
  issueRelationCreate: 'mutation-issue-relation-create-constructed',
  issueCreate: 'mutation-issue-create', issueUpdate: 'mutation-issue-update',
  issueComment: 'mutation-comment-create', issueLink: 'mutation-attachment-link-url-constructed',
};

describe('the hierarchy documents (D-8180)', () => {
  it('every hierarchy document is in LINEAR_DOCUMENTS, and a mutation appears only as a write row', () => {
    for (const doc of Object.values(LINEAR_HIERARCHY_DOCUMENTS)) expect(Object.values(LINEAR_DOCUMENTS)).toContain(doc);
    const writes = Object.values(LINEAR_CCRC_OPS).filter((r) => r.class === 'write').map((r) => r.document);
    for (const doc of Object.values(LINEAR_DOCUMENTS)) if (doc.startsWith('mutation')) expect(writes).toContain(doc);
  });

  it('no document deletes or archives an object (design 8.1)', () => {
    for (const doc of Object.values(LINEAR_DOCUMENTS)) {
      expect(doc).not.toMatch(/(?:issue|project|initiative|projectMilestone)(?:Delete|Archive)\b/);
    }
  });

  it('no milestone selection asks for a creator: Linear\'s ProjectMilestone has none (FX2, D-8407)', () => {
    // FX2's introspection of ProjectMilestone lists no `creator`, and every document that selected one answered HTTP
    // 400 GRAPHQL_VALIDATION_FAILED (`error-graphql-validation-milestone-creator`). A milestone binds by name in its project.
    const { projectById, changedProjects, changedMilestones } = LINEAR_HIERARCHY_DOCUMENTS;
    for (const doc of [projectById, changedProjects, changedMilestones]) {
      expect(doc.slice(doc.indexOf('projectMilestones('))).not.toContain('creator');
    }
    const milestone = { id: '00000000-0008-4000-8000-000000000002', name: 'Wave 1', description: null, targetDate: null, sortOrder: 1,
      updatedAt: '2026-11-13T16:13:20.088Z', project: { id: '00000000-0004-4000-8000-000000000001' } };
    const shaped = LINEAR_CCRC_OPS.changedMilestones.shape({ data: { projectMilestones: { nodes: [milestone], pageInfo: { hasNextPage: false, endCursor: null } } } });
    expect(shaped).toMatchObject({ ok: true });
    expect(JSON.stringify(shaped)).not.toContain('creator');
  });

  it('initiativeToProjectDelete is the only *Delete* document, and it unlinks, never removes an object', () => {
    expect(Object.keys(LINEAR_HIERARCHY_DOCUMENTS).filter((k) => /Delete$/.test(k))).toEqual(['initiativeToProjectDelete']);
  });

  it('the rows are the hierarchy documents plus the four issue rows, each journalling under the one list', () => {
    expect(Object.keys(LINEAR_CCRC_OPS).sort()).toEqual(
      [...Object.keys(LINEAR_HIERARCHY_DOCUMENTS), 'issueCreate', 'issueUpdate', 'issueComment', 'issueLink'].sort());
    const writes = Object.values(LINEAR_CCRC_OPS).filter((r) => r.class === 'write');
    for (const r of writes) expect(r.journalOp, r.op).not.toBeNull();
    for (const r of Object.values(LINEAR_CCRC_OPS).filter((x) => x.class === 'read')) expect(r.journalOp, r.op).toBeNull();
    for (const j of LINEAR_CCRC_JOURNAL_OPS) expect(writes.map((r) => r.journalOp), j).toContain(j);
  });
});

describe('the rows shape their answers', () => {
  it.each(Object.keys(LINEAR_CCRC_OPS))('%s shapes its constructed fixture', (op) => {
    const r = linearRecord(FIXTURE[op as CcrcOpName]);
    expect(r.document, op).toBe(LINEAR_CCRC_OPS[op as CcrcOpName].document);
    expect(LINEAR_CCRC_OPS[op as CcrcOpName].shape(r.body).ok).toBe(true);
  });

  it('a shaper refuses an answer outside its grammar as malformed', () => {
    expect(LINEAR_CCRC_OPS.projectById.shape({ data: { project: { id: 'not-a-uuid' } } })).toEqual({ ok: false, word: 'malformed' });
  });

  it('a create names the object it made, an update and a read name none', () => {
    const made = LINEAR_CCRC_OPS.projectCreate.shape(linearRecord(FIXTURE.projectCreate).body);
    expect(made).toMatchObject({ ok: true, created: '00000000-0004-4000-8000-000000000011' });
    expect(LINEAR_CCRC_OPS.projectUpdate.shape(linearRecord(FIXTURE.projectUpdate).body)).toMatchObject({ ok: true, created: null });
  });

  it('a mutation that did not succeed is refused, and an errors answer ends in its word', () => {
    expect(LINEAR_CCRC_OPS.projectCreate.shape({ data: { projectCreate: { success: false, project: null } } }))
      .toEqual({ ok: false, word: 'unreachable' });
    expect(LINEAR_CCRC_OPS.projectById.shape(linearRecord('error-not-found').body)).toEqual({ ok: false, word: 'not-found' });
  });

  it('an identifier and a team key are read by the shared grammars, an underscore included', () => {
    // `isLinearIdentifier` (ops.ts) and `isLinearTeamKey` (shared/linear.ts) accept `AB_1`: so does every hierarchy shaper.
    expect(isLinearTeamKey('AB_1')).toBe(true);
    expect(isLinearIdentifier('AB_1-5')).toBe(true);
    const issue = linearRecord(FIXTURE.issueOwned).body as { data: { issue: Record<string, unknown> } };
    const owned = { data: { issue: { ...issue.data.issue, identifier: 'AB_1-5', team: { key: 'AB_1' } } } };
    expect(LINEAR_CCRC_OPS.issueOwned.shape(owned)).toMatchObject({ ok: true, value: { issue: { identifier: 'AB_1-5', teamKey: 'AB_1' } } });
    const project = linearRecord(FIXTURE.projectById).body as { data: { project: Record<string, unknown> } };
    const inTeam = { data: { project: { ...project.data.project, teams: { nodes: [{ key: 'AB_1' }] } } } };
    expect(LINEAR_CCRC_OPS.projectById.shape(inTeam)).toMatchObject({ ok: true, value: { project: { teamKeys: ['AB_1'] } } });
    // And what the shared grammars refuse, the shapers refuse.
    const bad = { data: { issue: { ...issue.data.issue, identifier: 'AAA_12' } } };
    expect(LINEAR_CCRC_OPS.issueOwned.shape(bad)).toEqual({ ok: false, word: 'malformed' });
  });

  it('an issue write answer with no identifier, or one outside the grammar, is malformed', () => {
    for (const op of ['issueCreate', 'issueUpdate'] as const) {
      const body = linearRecord(FIXTURE[op]).body as { data: Record<string, { success: boolean; issue: Record<string, unknown> }> };
      const key = Object.keys(body.data)[0]!;
      const withIdent = (identifier: unknown) => ({ data: { [key]: { ...body.data[key], issue: { ...body.data[key]!.issue, identifier } } } });
      const { identifier: _gone, ...noIdent } = body.data[key]!.issue;
      expect(LINEAR_CCRC_OPS[op].shape({ data: { [key]: { ...body.data[key], issue: noIdent } } }), op).toEqual({ ok: false, word: 'malformed' });
      for (const v of ['not an identifier', 'AAA-', '-12', 12, null]) {
        expect(LINEAR_CCRC_OPS[op].shape(withIdent(v)), `${op} ${String(v)}`).toEqual({ ok: false, word: 'malformed' });
      }
    }
  });

  it('the two readers of the project statuses document take one status-type grammar', () => {
    const page = (type: string) => ({ data: { projectStatuses: { nodes: [{ id: '00000000-0008-4000-8000-000000000003', name: 'A status', type }] } } });
    for (const type of ['started', 'in_review', 'Started', '', 'a'.repeat(32), 'a'.repeat(33), 'in-review']) {
      expect(LINEAR_CCRC_OPS.projectStatuses.shape(page(type)).ok, type).toBe(readLinearProjectStatusesPage(page(type)).ok);
    }
    expect(readLinearProjectStatusesPage(page('in_review')).ok).toBe(true);
  });

  it('variables build only what the row names', () => {
    expect(LINEAR_CCRC_OPS.initiativeById.variables({ id: '00000000-0001-4000-8000-000000000001', extra: 'x' }))
      .toEqual({ id: '00000000-0001-4000-8000-000000000001' });
    expect(LINEAR_CCRC_OPS.projectCreate.variables({ requestId: '00000000-0004-4000-8000-000000000012', name: 'Project A', bogus: 1 }))
      .toEqual({ input: { id: '00000000-0004-4000-8000-000000000012', name: 'Project A' } });
    expect(LINEAR_CCRC_OPS.projectUpdate.variables({ id: '00000000-0004-4000-8000-000000000012', name: 'B' }))
      .toEqual({ id: '00000000-0004-4000-8000-000000000012', input: { name: 'B' } });
  });
});

describe('the initiatives probe and the provenance line', () => {
  it('readInitiativesProbe: nodes → on, anything else → unknown', () => {
    expect(readInitiativesProbe({ data: { initiatives: { nodes: [] } } })).toBe('on');
    expect(readInitiativesProbe({ data: null, errors: [{ message: 'x', extensions: { code: 'SOMETHING_ELSE' } }] })).toBe('unknown');
  });

  it('the probe row ends an errors answer in its word, never a state', () => {
    expect(LINEAR_CCRC_OPS.initiativesProbe.shape(RATELIMITED_ERRORS)).toEqual({ ok: false, word: 'rate-limited' });
    const auth = { data: null, errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] };
    expect(LINEAR_CCRC_OPS.initiativesProbe.shape(auth)).toMatchObject({ ok: false });
    expect(LINEAR_CCRC_OPS.initiativesProbe.shape({ data: { initiatives: { nodes: [] } } }))
      .toEqual({ ok: true, value: { state: 'on' }, created: null });
    expect(LINEAR_CCRC_OPS.initiativesProbe.shape({ data: { initiatives: null } }))
      .toEqual({ ok: true, value: { state: 'unknown' }, created: null });
  });

  it('the issue write rows answer the identifier beside the id', () => {
    for (const op of ['issueCreate', 'issueUpdate'] as const) {
      const r = LINEAR_CCRC_OPS[op].shape(linearRecord(FIXTURE[op]).body);
      expect(r).toMatchObject({ ok: true, value: { identifier: expect.stringMatching(/^[A-Za-z][A-Za-z0-9]*-\d+$/) } });
    }
  });

  it('withCcrcProvenance appends the line once', () => {
    expect(withCcrcProvenance(withCcrcProvenance('a'))).toBe(`a\n\n${LINEAR_CCRC_PROVENANCE_LINE}`);
    expect(withCcrcProvenance('')).toBe(LINEAR_CCRC_PROVENANCE_LINE);
  });
});

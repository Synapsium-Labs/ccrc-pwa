/**
 * THE CCRC OPERATION ROWS (D-8180; Linear hierarchy design 2026-11-10 §5, §8.1): what ccrc's own plan sync, drift pass
 * and migration may ask Linear, each a row with the document it sends (a constant of `ops.ts`: this file holds no
 * GraphQL text and no mutation), the variables it builds from a closed input, and the shaper that reads the answer.
 *
 * L1 POLICY: pure and total, no I/O. Inert until wave 3: nothing calls a row yet.
 *
 * LINEAR'S TEXT IS DATA. A shaper picks only the fields its document selects; an answer outside the grammar (a
 * non-UUID id, a missing field, a string where a list belongs) is `malformed`, never partly believed. One-line strings
 * pass `stripLine`, markdown `stripMultiline`, names `cleanName`. A mutation that did not report `success` is
 * `unreachable`, and an `errors` answer ends in the closed table's word (`linearErrorOf`).
 *
 * NO ROW DELETES OR ARCHIVES AN OBJECT. `initiativeToProjectDelete` removes a link between two objects, nothing else.
 */
import { isLinearUuid } from '../../../shared/linear.js';
import { cleanName, stripLine, stripMultiline } from '../../../shared/unprintable.js';
import {
  LINEAR_CCRC_PROVENANCE_LINE, LINEAR_DOCUMENTS, LINEAR_HIERARCHY_DOCUMENTS, linearErrorOf, type LinearAnswerRefusalWord,
} from './ops.js';

/** The journal operations the hierarchy rows write under: the one list the policy and the journal read (Task 1.2). */
export const LINEAR_CCRC_JOURNAL_OPS = [
  'initiative-create', 'initiative-update', 'initiative-link', 'initiative-unlink', 'project-create', 'project-update',
  'milestone-create', 'milestone-update', 'relation-create',
] as const;
export type LinearCcrcJournalOp = (typeof LINEAR_CCRC_JOURNAL_OPS)[number];

/** The closed record a row's `variables` reads: ids are lowercase UUIDs, texts already through `linear-egress`. */
export type CcrcOpInput = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
export type CcrcShaped =
  | { ok: true; value: Record<string, unknown>; created: string | null }
  | { ok: false; word: LinearAnswerRefusalWord };

type JournalOp = LinearCcrcJournalOp | 'create' | 'update' | 'comment' | 'link';
type HierarchyKey = keyof typeof LINEAR_HIERARCHY_DOCUMENTS;
export type CcrcOpName = HierarchyKey | 'issueCreate' | 'issueUpdate' | 'issueComment' | 'issueLink';

export interface CcrcOpRow {
  op: CcrcOpName;
  class: 'read' | 'write';
  document: string;
  journalOp: JournalOp | null;
  variables(input: CcrcOpInput): Record<string, unknown>;
  shape(body: unknown): CcrcShaped;
}

// ── the provenance line ──

/** `text` with the ccrc provenance line appended after a blank line, unless it already ends with it. */
export function withCcrcProvenance(text: string): string {
  const t = text.replace(/\s+$/u, '');
  if (t === LINEAR_CCRC_PROVENANCE_LINE || t.endsWith(`\n${LINEAR_CCRC_PROVENANCE_LINE}`)) return text;
  return text === '' ? LINEAR_CCRC_PROVENANCE_LINE : `${text}\n\n${LINEAR_CCRC_PROVENANCE_LINE}`;
}

// ── the closed grammar of an answer ──

const BAD: unique symbol = Symbol('malformed');
type Bad = typeof BAD;
type Read<T> = (v: unknown) => T | Bad;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_TYPE = /^[a-z_]{1,32}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;
const TEAM_KEY = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

const uuid: Read<string> = (v) => (isLinearUuid(v) ? v : BAD);
const time: Read<string> = (v) => (typeof v === 'string' && ISO_TIME.test(v) ? v : BAD);
const dateOrNull: Read<string | null> = (v) => (v === null ? null : typeof v === 'string' && ISO_DATE.test(v) ? v : BAD);
const name: Read<string> = (v) => cleanName(v) ?? BAD;
const line: Read<string> = (v) => (typeof v === 'string' ? stripLine(v) : BAD);
const lineOrNull: Read<string | null> = (v) => (v === null ? null : line(v));
const markdown: Read<string> = (v) => (typeof v === 'string' ? stripMultiline(v) : BAD);
const markdownOrNull: Read<string | null> = (v) => (v === null ? null : markdown(v));
const stateType: Read<string> = (v) => (typeof v === 'string' && STATE_TYPE.test(v) ? v : BAD);
const identifier: Read<string> = (v) => (typeof v === 'string' && IDENTIFIER.test(v) ? v : BAD);
const teamKey: Read<string> = (v) => (typeof v === 'string' && TEAM_KEY.test(v) ? v : BAD);
const sortOrder: Read<number> = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : BAD);

/** The `field` of an object, read by `r`; a missing field is read as `undefined` and refused by every reader. */
const at = <T>(o: unknown, field: string, r: Read<T>): T | Bad => (isObj(o) ? r(o[field]) : BAD);
/** The `{ id }` object a nullable relation holds, as its id (or null). */
const relationId: Read<string | null> = (v) => (v === null ? null : at(v, 'id', uuid));
/** A connection's nodes, each read by `r`. */
const nodesOf = <T>(r: Read<T>): Read<T[]> => (v) => {
  if (!isObj(v) || !Array.isArray(v['nodes'])) return BAD;
  const out: T[] = [];
  for (const n of v['nodes']) {
    const x = r(n);
    if (x === BAD) return BAD;
    out.push(x as T);
  }
  return out;
};
const idOf: Read<string> = (n) => at(n, 'id', uuid);
const keyOf: Read<string> = (n) => at(n, 'key', teamKey);

/** An object read field by field into a flat record; one bad field makes the whole object bad. */
const record = (spec: Readonly<Record<string, (o: unknown) => unknown>>): Read<Record<string, unknown>> => (v) => {
  if (!isObj(v)) return BAD;
  const out: Record<string, unknown> = {};
  for (const [k, read] of Object.entries(spec)) {
    const x = read(v);
    if (x === BAD) return BAD;
    out[k] = x;
  }
  return out;
};
const f = <T>(field: string, r: Read<T>) => (o: unknown): T | Bad => at(o, field, r);

const initiativeRecord = record({
  id: f('id', uuid), name: f('name', name), description: f('description', markdownOrNull), status: f('status', lineOrNull),
  updatedAt: f('updatedAt', time),
  projectIds: (o) => at(o, 'projects', nodesOf(idOf)),
});
const milestoneRecord = record({
  id: f('id', uuid), name: f('name', name), description: f('description', markdownOrNull),
  targetDate: f('targetDate', dateOrNull), sortOrder: f('sortOrder', sortOrder), updatedAt: f('updatedAt', time),
  creatorId: f('creator', relationId),
});
const projectRecord = record({
  id: f('id', uuid), name: f('name', name), description: f('description', markdownOrNull), updatedAt: f('updatedAt', time),
  statusId: (o) => at(o, 'status', (s) => (s === null ? null : at(s, 'id', uuid))),
  statusType: (o) => at(o, 'status', (s) => (s === null ? null : at(s, 'type', stateType))),
  teamKeys: (o) => at(o, 'teams', nodesOf(keyOf)),
  initiativeIds: (o) => at(o, 'initiatives', nodesOf(idOf)),
  milestones: (o) => at(o, 'projectMilestones', nodesOf(milestoneRecord)),
});
const changedMilestoneRecord = record({
  id: f('id', uuid), name: f('name', name), description: f('description', markdownOrNull),
  targetDate: f('targetDate', dateOrNull), sortOrder: f('sortOrder', sortOrder), updatedAt: f('updatedAt', time),
  projectId: f('project', relationId), creatorId: f('creator', relationId),
});
const namedRecord = record({
  id: f('id', uuid), name: f('name', name), createdAt: f('createdAt', time), creatorId: f('creator', relationId),
});
const namedProjectRecord = record({
  id: f('id', uuid), name: f('name', name), createdAt: f('createdAt', time), creatorId: f('creator', relationId),
  teamKeys: (o) => at(o, 'teams', nodesOf(keyOf)),
});
const issueRecord = record({
  id: f('id', uuid), identifier: f('identifier', identifier), title: f('title', line),
  description: f('description', markdownOrNull), updatedAt: f('updatedAt', time), teamKey: (o) => at(o, 'team', keyOf),
  stateType: (o) => at(o, 'state', (s) => at(s, 'type', stateType)),
  projectId: f('project', relationId), milestoneId: f('projectMilestone', relationId), parentId: f('parent', relationId),
  labelIds: (o) => at(o, 'labels', nodesOf(idOf)),
});
const statusRecord = record({ id: f('id', uuid), name: f('name', name), type: f('type', stateType) });

// ── shapers ──

const MALFORMED: CcrcShaped = Object.freeze({ ok: false, word: 'malformed' });
const refused = (word: LinearAnswerRefusalWord): CcrcShaped => ({ ok: false, word });

/** The answer's `data`, or the word it ends in. */
function dataOf(body: unknown): Record<string, unknown> | CcrcShaped {
  const err = linearErrorOf(body);
  if (err !== null) return refused(err.word);
  if (!isObj(body) || !isObj(body['data'])) return MALFORMED;
  return body['data'];
}
const isShaped = (v: Record<string, unknown> | CcrcShaped): v is CcrcShaped => 'ok' in v && typeof v['ok'] === 'boolean';

/** A query for one object by id: `null` is `not-found`. */
const oneShape = (key: string, read: Read<Record<string, unknown>>, out: string) => (body: unknown): CcrcShaped => {
  const data = dataOf(body);
  if (isShaped(data)) return data;
  if (!(key in data)) return MALFORMED;
  if (data[key] === null) return refused('not-found');
  const v = read(data[key]);
  return v === BAD ? MALFORMED : { ok: true, value: { [out]: v }, created: null };
};

/** A query for a connection: its nodes, and the next cursor when the row pages. */
const listShape = (key: string, read: Read<Record<string, unknown>>, paged: boolean) => (body: unknown): CcrcShaped => {
  const data = dataOf(body);
  if (isShaped(data)) return data;
  const conn = data[key];
  const nodes = nodesOf(read)(conn);
  if (nodes === BAD) return MALFORMED;
  if (!paged) return { ok: true, value: { nodes }, created: null };
  const info = isObj(conn) ? conn['pageInfo'] : undefined;
  if (!isObj(info) || typeof info['hasNextPage'] !== 'boolean') return MALFORMED;
  const end = info['endCursor'];
  if (end !== null && (typeof end !== 'string' || end === '' || end.length > 512)) return MALFORMED;
  return { ok: true, value: { nodes, next: info['hasNextPage'] ? end : null }, created: null };
};

/** A mutation's answer: `success` true, and for a create the new object's id. */
const writeShape = (key: string, object: string | null, creates: boolean) => (body: unknown): CcrcShaped => {
  const data = dataOf(body);
  if (isShaped(data)) return data;
  const payload = data[key];
  if (!isObj(payload) || typeof payload['success'] !== 'boolean') return MALFORMED;
  if (payload['success'] !== true) return refused('unreachable');
  if (object === null) return { ok: true, value: {}, created: null };
  const id = at(payload[object], 'id', uuid);
  if (id === BAD) return MALFORMED;
  return { ok: true, value: { id }, created: creates ? id : null };
};

/** Whether the initiatives capability answered: `nodes` means on. The off answer is unrecorded until FX2 (design §15),
 *  so everything else is `unknown`, never `off`. */
export function readInitiativesProbe(body: unknown): 'on' | 'off' | 'unknown' {
  if (!isObj(body) || !isObj(body['data']) || linearErrorOf(body) !== null) return 'unknown';
  return Array.isArray((body['data']['initiatives'] as { nodes?: unknown } | null)?.nodes) ? 'on' : 'unknown';
}
const probeShape = (body: unknown): CcrcShaped => ({ ok: true, value: { state: readInitiativesProbe(body) }, created: null });

const statusesShape = (body: unknown): CcrcShaped => {
  const data = dataOf(body);
  if (isShaped(data)) return data;
  const nodes = nodesOf(statusRecord)(data['projectStatuses']);
  return nodes === BAD ? MALFORMED : { ok: true, value: { statuses: nodes }, created: null };
};

// ── variables ──

/** The `keys` of `input` present in it, in the order listed (a key the row does not name is dropped). */
const pick = (input: CcrcOpInput, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in input) out[k] = input[k];
  return out;
};
const readVars = (...keys: string[]) => (input: CcrcOpInput): Record<string, unknown> => pick(input, keys);
/** A create's variables: `{ input }`, the caller's `requestId` sent as the new object's own `id` (the retry guard). */
const createVars = (...keys: string[]) => (input: CcrcOpInput): Record<string, unknown> => {
  const fields = pick(input, keys);
  return { input: 'requestId' in input ? { id: input['requestId'], ...fields } : fields };
};
const updateVars = (...keys: string[]) => (input: CcrcOpInput): Record<string, unknown> => ({
  id: input['id'] ?? null, input: pick(input, keys),
});

const D = LINEAR_HIERARCHY_DOCUMENTS;
const PROJECT_KEYS = ['name', 'description', 'statusId', 'teamIds', 'priority'] as const;
const ISSUE_KEYS = ['teamId', 'title', 'description', 'stateId', 'projectId', 'projectMilestoneId', 'parentId', 'labelIds', 'priority'] as const;

const row = (r: CcrcOpRow): CcrcOpRow => Object.freeze(r);
const read = (op: CcrcOpName, document: string, variables: CcrcOpRow['variables'], shape: CcrcOpRow['shape']): CcrcOpRow =>
  row({ op, class: 'read', document, journalOp: null, variables, shape });
const write = (op: CcrcOpName, document: string, journalOp: JournalOp, variables: CcrcOpRow['variables'], shape: CcrcOpRow['shape']): CcrcOpRow =>
  row({ op, class: 'write', document, journalOp, variables, shape });

/** THE CCRC OPERATION TABLE: one row per operation, the hierarchy documents and the four issue rows (which reuse the
 *  session documents' text, the answers read for their ids only). */
export const LINEAR_CCRC_OPS: Readonly<Record<CcrcOpName, CcrcOpRow>> = Object.freeze({
  initiativeById: read('initiativeById', D.initiativeById, readVars('id'), oneShape('initiative', initiativeRecord, 'initiative')),
  projectById: read('projectById', D.projectById, readVars('id'), oneShape('project', projectRecord, 'project')),
  projectStatuses: read('projectStatuses', D.projectStatuses, readVars(), statusesShape),
  initiativesProbe: read('initiativesProbe', D.initiativesProbe, readVars(), probeShape),
  initiativesByName: read('initiativesByName', D.initiativesByName, readVars('name'), listShape('initiatives', namedRecord, false)),
  projectsByName: read('projectsByName', D.projectsByName, readVars('name'), listShape('projects', namedProjectRecord, false)),
  changedInitiatives: read('changedInitiatives', D.changedInitiatives, readVars('since', 'after'), listShape('initiatives', initiativeRecord, true)),
  changedProjects: read('changedProjects', D.changedProjects, readVars('since', 'after'), listShape('projects', projectRecord, true)),
  changedMilestones: read('changedMilestones', D.changedMilestones, readVars('since', 'after'),
    listShape('projectMilestones', changedMilestoneRecord, true)),
  changedIssues: read('changedIssues', D.changedIssues, readVars('since', 'teams', 'after'), listShape('issues', issueRecord, true)),
  teamOpenIssues: read('teamOpenIssues', D.teamOpenIssues, readVars('team', 'after'), listShape('issues', issueRecord, true)),
  issueOwned: read('issueOwned', D.issueOwned, readVars('id'), oneShape('issue', issueRecord, 'issue')),

  initiativeCreate: write('initiativeCreate', D.initiativeCreate, 'initiative-create',
    createVars('name', 'description', 'status'), writeShape('initiativeCreate', 'initiative', true)),
  initiativeUpdate: write('initiativeUpdate', D.initiativeUpdate, 'initiative-update',
    updateVars('name', 'description', 'status'), writeShape('initiativeUpdate', 'initiative', false)),
  initiativeToProjectCreate: write('initiativeToProjectCreate', D.initiativeToProjectCreate, 'initiative-link',
    createVars('initiativeId', 'projectId'), writeShape('initiativeToProjectCreate', 'initiativeToProject', true)),
  initiativeToProjectDelete: write('initiativeToProjectDelete', D.initiativeToProjectDelete, 'initiative-unlink',
    readVars('id'), writeShape('initiativeToProjectDelete', null, false)),
  projectCreate: write('projectCreate', D.projectCreate, 'project-create',
    createVars(...PROJECT_KEYS), writeShape('projectCreate', 'project', true)),
  projectUpdate: write('projectUpdate', D.projectUpdate, 'project-update',
    updateVars(...PROJECT_KEYS), writeShape('projectUpdate', 'project', false)),
  projectMilestoneCreate: write('projectMilestoneCreate', D.projectMilestoneCreate, 'milestone-create',
    createVars('projectId', 'name', 'description', 'targetDate', 'sortOrder'), writeShape('projectMilestoneCreate', 'projectMilestone', true)),
  projectMilestoneUpdate: write('projectMilestoneUpdate', D.projectMilestoneUpdate, 'milestone-update',
    updateVars('name', 'description', 'targetDate', 'sortOrder'), writeShape('projectMilestoneUpdate', 'projectMilestone', false)),
  issueRelationCreate: write('issueRelationCreate', D.issueRelationCreate, 'relation-create',
    createVars('issueId', 'relatedIssueId', 'type'), writeShape('issueRelationCreate', 'issueRelation', true)),

  issueCreate: write('issueCreate', LINEAR_DOCUMENTS.create, 'create', createVars(...ISSUE_KEYS), writeShape('issueCreate', 'issue', true)),
  issueUpdate: write('issueUpdate', LINEAR_DOCUMENTS.update, 'update', updateVars(...ISSUE_KEYS),
    writeShape('issueUpdate', 'issue', false)),
  issueComment: write('issueComment', LINEAR_DOCUMENTS.comment, 'comment', createVars('issueId', 'body'), writeShape('commentCreate', 'comment', true)),
  issueLink: write('issueLink', LINEAR_DOCUMENTS.link, 'link', readVars('issueId', 'url', 'title'), writeShape('attachmentLinkURL', 'attachment', true)),
});

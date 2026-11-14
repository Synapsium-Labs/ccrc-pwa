// The recorded Linear fixtures (#1444, D-7684's FX act, D-7743; spec 2026-10-31 §4.1, §6.7).
//
// `fixtures/linear/` holds one file per answer the FX capture recorded from Linear on 2026-11-02, scrubbed to the
// fixture vocabulary (README.md there says what was replaced and what was kept), the hierarchy capture's answers of
// 2026-11-13 (FX2, D-8407), and the constructed answers, whose file names say so: the rate-limited one, the link
// mutation's (D-8141), and the six hierarchy documents FX2 did not record (D-8180), each awaiting its recording. This
// file holds four things of them:
//
//   1. EVERY FILE PARSES, and is one record of the capture's shape: the request it sent and the answer it got, the
//      raw body equal to the parsed one, the request body equal to the document and variables it names.
//   2. EVERY MERGED DOCUMENT IS RECORDED, BYTE FOR BYTE. Each `LINEAR_DOCUMENTS` constant (`ops.ts`) and the two
//      documents `client.ts` sends (the title lookup's and the key check's, read here off the fetch seam because
//      they are not exported) has a fixture whose `document` equals it. A document changed without a re-capture
//      turns this red, which is the rule the plan's FX item sets: a changed document is re-captured before it lands.
//   3. WHAT FX2 MEASURED: the answers README.md's "What FX2 measured" section states, read off the recordings.
//   4. THE LEAK GUARD. These files are public. No fixture names an email outside `example.invalid`, a key other than
//      the `lin_api_fixture` shape, or a UUID outside the fixture set; the guard's own liveness rows prove it fires.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkLinearKey, lookupLinearIssue, verifyLinearKey, type FetchLike } from '../src/linear/client.js';
import { LINEAR_DOCUMENTS, LINEAR_HIERARCHY_DOCUMENTS } from '../src/linear/ops.js';
import { LINEAR_QUOTA } from '../src/linear/rate.js';
import { linearAnswer } from './linearFetchFake.js';
import { LINEAR_RECORD_DIR, LINEAR_RECORD_FILES, linearRecord, recordedHeader as header, type LinearRecord } from './linearRecorded.js';

const FILES = LINEAR_RECORD_FILES;
// Every file, the README included: the leak guard reads them all.
const TEXT = new Map(readdirSync(LINEAR_RECORD_DIR).sort().map((f) => [f, readFileSync(path.join(LINEAR_RECORD_DIR, f), 'utf8')]));
const RECORDS = new Map<string, LinearRecord>(FILES.map((f) => [f, linearRecord(f)]));

/** The hierarchy documents FX2 did not record (D-8180, D-8407), each with its constructed file. `changedProjects` and
 *  `changedMilestones` answered HTTP 400 for the milestone `creator` D-8407 removed, so their corrected documents are
 *  unsent; `changedIssues`, `teamOpenIssues` and `projectUpdate` were not in the run, and `initiativeToProjectDelete`
 *  ran only as the capture's unrecorded cleanup. */
const HIERARCHY_FILE: Readonly<Partial<Record<keyof typeof LINEAR_HIERARCHY_DOCUMENTS, string>>> = {
  changedProjects: 'read-changed-projects', changedMilestones: 'read-changed-milestones', changedIssues: 'read-changed-issues',
  teamOpenIssues: 'read-team-open-issues', initiativeToProjectDelete: 'mutation-initiative-to-project-delete',
  projectUpdate: 'mutation-project-update',
};
/** The same files, in file-name order. */
const HIERARCHY_CONSTRUCTED = Object.values(HIERARCHY_FILE).sort().map((n) => `${n}-constructed.json`);
/** The FX2 recordings (D-8407): they kept no clock and no status line, so those fields are null. */
const FX2 = (f: string): boolean => RECORDS.get(f)!.sentAtMs === null;

describe('every fixture parses, one capture record each', () => {
  it('holds the recorded set and the constructed answers', () => {
    // 31 recorded answers of FX1 (the capture's cleanup and cleanup-verify calls are not kept), 38 of FX2 (D-8407; its
    // cleanup is not kept either), the constructed 429, the constructed link mutation (D-8141) and the six constructed
    // hierarchy answers FX2 did not record (D-8180).
    expect(FILES).toHaveLength(77);
    expect(FILES.filter((f) => FX2(f))).toHaveLength(38);
    expect(FILES.filter((f) => f.includes('constructed'))).toEqual(
      ['error-429-ratelimited-constructed.json', 'mutation-attachment-link-url-constructed.json', ...HIERARCHY_CONSTRUCTED].sort());
  });

  it.each(FILES)('%s is a whole record', (f) => {
    const r = RECORDS.get(f)!;
    expect(`${r.name}.json`).toBe(f);
    expect(typeof r.document).toBe('string');
    expect(typeof r.status).toBe('number');
    // FX1 kept the clock and the status line; FX2 kept neither, and says so with null, never a made-up value.
    if (FX2(f)) expect([r.receivedAtMs, r.sentAt, r.statusLine]).toEqual([null, null, null]);
    else expect([typeof r.sentAtMs, typeof r.receivedAtMs, typeof r.sentAt, typeof r.statusLine]).toEqual(['number', 'number', 'string', 'string']);
    expect(Array.isArray(r.headers)).toBe(true);
    // The raw body is the parsed one as Linear sends it (compact, one trailing newline), and the request body is the
    // document and variables the record names, so neither half can drift from the other.
    expect(r.bodyRaw).toBe(`${JSON.stringify(r.body)}\n`);
    expect(r.requestBody).toBe(JSON.stringify({ query: r.document, variables: r.variables }));
    const length = header(r, 'content-length');
    if (length !== null) expect(Number(length)).toBe(Buffer.byteLength(r.bodyRaw, 'utf8'));
    // Only the constructed file says it was constructed, and it says so in its name.
    expect('constructed' in r).toBe(f.includes('constructed'));
  });
});

describe('every merged document has a fixture, byte for byte', () => {
  const recorded = (doc: string): string[] =>
    [...RECORDS.entries()].filter(([f, r]) => r.document === doc && !f.includes('constructed')).map(([f]) => f);

  /** THE ONE EXCEPTION to "recorded before it lands" (D-8141): the link mutation was written when no session may call
   *  Linear, so its fixture is constructed from the schema. Remove this row when `mutation-attachment-link-url.json` is
   *  recorded; the test below it fails the day both exist, so the exception cannot outlive the recording. */
  const AWAITING_RECAPTURE: Readonly<Record<string, readonly string[]>> = {
    link: ['mutation-attachment-link-url-constructed.json'],
    // The hierarchy documents FX2 did not record (D-8180, D-8407). Each row leaves when its recording lands.
    ...Object.fromEntries(Object.entries(HIERARCHY_FILE).map(([k, n]) => [k, [`${n}-constructed.json`]])),
  };
  /** AN ANSWER NO CAPTURE COULD RECORD, though its document is recorded: the initiatives probe on a workspace with
   *  initiatives off (FX2 item 5; no workspace the operator has is off). Its file does not exist yet; the day it is
   *  recorded under this name, the row goes and `readInitiativesProbe` may learn `off`. */
  const AWAITING_ANSWER: Readonly<Record<string, string>> = { initiativesProbe: 'read-initiatives-probe-off.json' };
  const constructedFor = (doc: string): string[] =>
    [...RECORDS.entries()].filter(([f, r]) => r.document === doc && f.includes('constructed')).map(([f]) => f);

  it.each(Object.entries(LINEAR_DOCUMENTS))('LINEAR_DOCUMENTS.%s', (name, doc) => {
    const waiting = AWAITING_RECAPTURE[name];
    if (waiting === undefined) expect(recorded(doc)).not.toEqual([]);
    else expect(constructedFor(doc).sort()).toEqual([...waiting].sort());
  });

  it('every constructed answer to a merged document is named by its recapture row, so a recording retires it', () => {
    // The 429 is the one constructed answer to no LINEAR_DOCUMENTS entry: it constructs an error, not a document.
    const named = new Set(Object.values(AWAITING_RECAPTURE).flat());
    const documents = new Set<string>(Object.values(LINEAR_DOCUMENTS));
    const loose = [...RECORDS.entries()].filter(([f, r]) => f.includes('constructed') && documents.has(r.document) && !named.has(f));
    expect(loose.map(([f]) => f)).toEqual([]);
  });

  it('the recapture exception holds only while the document has no recording', () => {
    for (const name of Object.keys(AWAITING_RECAPTURE)) {
      expect(recorded(LINEAR_DOCUMENTS[name as keyof typeof LINEAR_DOCUMENTS]), name).toEqual([]);
    }
  });

  it('an awaited answer has no file, and its document is recorded otherwise', () => {
    for (const [name, file] of Object.entries(AWAITING_ANSWER)) {
      expect(FILES, name).not.toContain(file);
      expect(recorded(LINEAR_DOCUMENTS[name as keyof typeof LINEAR_DOCUMENTS]), name).not.toEqual([]);
    }
  });

  /** The documents `client.ts` sends, read off the fetch seam: they are module constants, not exports. */
  const sent = async (run: (fetch: FetchLike) => Promise<unknown>): Promise<string[]> => {
    const docs: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      docs.push((JSON.parse(init.body) as { query: string }).query);
      return linearAnswer({ ok: true, status: 200, json: async () => ({ data: null }) });
    };
    await run(fetch);
    return docs;
  };

  it('client.ts QUERY, the title lookup', async () => {
    const docs = await sent((fetch) =>
      lookupLinearIssue({ key: 'AAA', num: '1' }, { kind: 'key', key: 'lin_api_fixtureTitle' }, { fetch }));
    expect(docs).toHaveLength(1);
    expect(recorded(docs[0]!)).toEqual(['read-title.json']);
  });

  it('client.ts KEY_CHECK_QUERY, both pages of the key check', async () => {
    const verify = await sent((fetch) => verifyLinearKey('lin_api_fixtureCheck', { fetch }));
    const check = await sent((fetch) => checkLinearKey(async () => ({ kind: 'key', key: 'lin_api_fixtureCheck' }), { fetch }));
    expect(verify).toHaveLength(1);
    expect(check).toEqual(verify);
    expect(recorded(verify[0]!)).toEqual(
      ['error-401-invalid-key.json', 'error-401-revoked-key.json', 'key-check-page-1.json', 'key-check-page-2.json']);
  });
});

describe('what the recorded headers say (spec §1.2a, §6.7)', () => {
  const recordedFiles = FILES.filter((f) => !f.includes('constructed'));

  it.each(recordedFiles.filter((f) => header(RECORDS.get(f)!, 'x-complexity') !== null))(
    '%s: X-Complexity is under the single-query cap', (f) => {
      expect(Number(header(RECORDS.get(f)!, 'x-complexity'))).toBeLessThan(LINEAR_QUOTA.maxQueryComplexity);
    });

  it.each(recordedFiles.filter((f) => header(RECORDS.get(f)!, 'x-ratelimit-requests-reset') !== null))(
    '%s: the reset headers are absolute epoch milliseconds, about an hour after the send', (f) => {
      const r = RECORDS.get(f)!;
      // FX2 kept no clock of its own (sentAtMs null): its reset is checked against the two minutes of its run instead.
      const sentAtMs = r.sentAtMs ?? Date.parse('2026-11-13T16:12:00Z');
      for (const name of ['x-ratelimit-requests-reset', 'x-ratelimit-complexity-reset']) {
        const ahead = Number(header(r, name)) - sentAtMs;
        if (r.sentAtMs === null) {
          expect(ahead).toBeGreaterThan(3_600_000);
          expect(ahead).toBeLessThan(3_720_000);
          continue;
        }
        expect(ahead).toBeGreaterThan(3_599_000);
        expect(ahead).toBeLessThan(3_602_000);
      }
      expect(header(r, 'x-ratelimit-requests-limit')).toBe(String(LINEAR_QUOTA.requestsPerHour));
      expect(header(r, 'x-ratelimit-complexity-limit')).toBe(String(LINEAR_QUOTA.complexityPerHour));
      expect(header(r, 'retry-after')).toBeNull();
    });

  it('a 401 carries no complexity and no rate-limit header', () => {
    for (const f of ['error-401-invalid-key.json', 'error-401-revoked-key.json']) {
      const r = RECORDS.get(f)!;
      expect(r.status).toBe(401);
      expect(r.headers.filter(([k]) => /^x-(complexity|ratelimit-)/i.test(k))).toEqual([]);
    }
  });
});

// ── what FX2 measured (README.md, D-8407) ──

describe('what FX2 measured', () => {
  type Field = { name: string };
  const inputFields = (f: string): string[] =>
    ((RECORDS.get(f)!.body as { data: { __type: { inputFields: Field[] } } }).data.__type.inputFields).map((x) => x.name);
  const typeFields = (f: string): string[] =>
    ((RECORDS.get(f)!.body as { data: { __type: { fields: Field[] } } }).data.__type.fields).map((x) => x.name);
  const firstError = (f: string): { message: string; extensions: Record<string, unknown> } =>
    (RECORDS.get(f)!.body as { errors: { message: string; extensions: Record<string, unknown> }[] }).errors[0]!;
  const data = (f: string): Record<string, any> => (RECORDS.get(f)!.body as { data: Record<string, any> }).data;

  it('1. initiative, project and milestone creates take a caller-chosen id; a repeat is refused, and a milestone\'s name is checked first', () => {
    for (const t of ['initiative-create-input', 'project-create-input', 'project-milestone-create-input']) {
      expect(inputFields(`introspection-${t}.json`), t).toContain('id');
    }
    for (const [f, key, object] of [['mutation-initiative-create.json', 'initiativeCreate', 'initiative'],
      ['mutation-project-create.json', 'projectCreate', 'project'],
      ['mutation-project-milestone-create.json', 'projectMilestoneCreate', 'projectMilestone']] as const) {
      const sent = (RECORDS.get(f)!.variables['input'] as { id: string }).id;
      expect(data(f)[key][object].id, f).toBe(sent);
    }
    expect(firstError('mutation-initiative-create-same-id.json').message).toBe('conflict on insert of Initiative');
    expect(firstError('mutation-project-create-same-id.json').message).toBe('conflict on insert of Project');
    expect(firstError('mutation-project-milestone-create-same-id.json').message).toBe('name not unique');
    for (const f of ['mutation-initiative-create-same-id.json', 'mutation-project-create-same-id.json', 'mutation-project-milestone-create-same-id.json']) {
      expect(RECORDS.get(f)!.status, f).toBe(200);
      expect(firstError(f).extensions['code'], f).toBe('INPUT_ERROR');
    }
  });

  it('2. InitiativeStatus has a canceled value, and the project statuses come with five types', () => {
    const values = (RECORDS.get('introspection-initiative-status.json')!.body as { data: { __type: { enumValues: Field[] } } })
      .data.__type.enumValues.map((v) => v.name);
    expect(values).toEqual(['Proposed', 'Planned', 'Active', 'Completed', 'Canceled']);
    const set = FILES.filter((f) => f.startsWith('mutation-initiative-update-status-'))
      .map((f) => (RECORDS.get(f)!.variables['input'] as { status: string }).status);
    expect(set.sort()).toEqual([...values].sort());
    const types = (data('read-project-statuses.json')['projectStatuses'].nodes as { type: string }[]).map((n) => n.type);
    expect(types.sort()).toEqual(['backlog', 'canceled', 'completed', 'planned', 'started']);
  });

  it('3. a comment takes an issue, a project, an initiative or their updates, never a milestone', () => {
    const fields = inputFields('introspection-comment-create-input.json');
    for (const f of ['issueId', 'projectId', 'initiativeId', 'projectUpdateId', 'initiativeUpdateId']) expect(fields).toContain(f);
    expect(fields.filter((f) => /milestone/i.test(f))).toEqual([]);
    expect(data('mutation-comment-create-on-initiative.json')['commentCreate'].success).toBe(true);
    expect(data('mutation-comment-create-on-project.json')['commentCreate'].success).toBe(true);
  });

  it('4. a milestone update moves neither its project\'s updatedAt nor its own', () => {
    const before = data('read-project-by-id-milestone-update-before.json')['project'];
    const after = data('read-project-by-id-milestone-update-after.json')['project'];
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.projectMilestones.nodes[0].description).not.toBe(before.projectMilestones.nodes[0].description);
    expect(after.projectMilestones.nodes[0].updatedAt).toBe(before.projectMilestones.nodes[0].updatedAt);
  });

  it('5. the initiatives probe on a workspace with initiatives on and none made is an empty list', () => {
    expect(data('read-initiatives-probe.json')).toEqual({ initiatives: { nodes: [] } });
  });

  it('7. exact-name reads hold and read the key\'s viewer as creator; ProjectMilestone has no creator', () => {
    const viewer = data('extra-viewer.json')['viewer'].id;
    const initiative = data('read-initiatives-by-name.json')['initiatives'].nodes;
    const project = data('read-projects-by-name.json')['projects'].nodes;
    expect(initiative).toHaveLength(1);
    expect(project).toHaveLength(1);
    expect(initiative[0].creator.id).toBe(viewer);
    expect(project[0].creator.id).toBe(viewer);
    expect(initiative[0].name).toBe(RECORDS.get('read-initiatives-by-name.json')!.variables['name']);
    expect(data('read-initiatives-by-name-near-miss.json')['initiatives'].nodes).toEqual([]);
    expect(typeFields('introspection-project-milestone.json')).not.toContain('creator');
    const refused = RECORDS.get('error-graphql-validation-milestone-creator.json')!;
    expect(refused.status).toBe(400);
    expect((refused.body as { errors: { message: string; extensions: { code: string } }[] }).errors[0])
      .toMatchObject({ message: 'Cannot query field "creator" on type "ProjectMilestone".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } });
  });

  it('a project name over 80 characters is refused, INVALID_INPUT', () => {
    const r = RECORDS.get('error-project-name-too-long.json')!;
    expect([...(r.variables['input'] as { name: string }).name]).toHaveLength(85);
    expect(firstError('error-project-name-too-long.json').extensions).toMatchObject({
      code: 'INVALID_INPUT', userPresentableMessage: 'name must be shorter than or equal to 80 characters.',
    });
  });
});

// ── the leak guard ──

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const KEY = /lin_api_[A-Za-z0-9_]*/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** The fixture set: `00000000-<kind>-4000-8000-<n>`, a kind word of 0 to 8 (README.md lists them) and a serial. */
const FIXTURE_UUID = /^00000000-000[0-8]-4000-8000-0000000000[0-9a-f]{2}$/;

/** Every token in a text that the public tree may not carry. */
const leaksIn = (text: string): string[] => [
  ...[...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => !e.endsWith('@example.invalid')),
  ...[...text.matchAll(KEY)].map((m) => m[0]).filter((k) => !k.startsWith('lin_api_fixture')),
  ...[...text.matchAll(UUID)].map((m) => m[0]).filter((u) => !FIXTURE_UUID.test(u)),
];

describe('the leak guard', () => {
  it.each([...TEXT.keys()])('%s names no real email, key or id', (f) => {
    expect(leaksIn(TEXT.get(f)!)).toEqual([]);
  });

  it('fires on each kind it guards (its liveness)', () => {
    expect(leaksIn('"email": "someone@example.com"')).toEqual(['someone@example.com']);
    expect(leaksIn('"key": "lin_api_Q7mK2pX9vR4sT8wY1zB6nC3dF5gH0jL"')).toEqual(['lin_api_Q7mK2pX9vR4sT8wY1zB6nC3dF5gH0jL']);
    expect(leaksIn('"id": "4b1c9e2a-7d3f-4a8b-9c0d-1e2f3a4b5c6d"')).toEqual(['4b1c9e2a-7d3f-4a8b-9c0d-1e2f3a4b5c6d']);
    expect(leaksIn('"id": "00000000-0009-4000-8000-000000000001"')).toHaveLength(1);
    expect(leaksIn('user-a@example.invalid lin_api_fixtureAlpha 00000000-0005-4000-8000-000000000001')).toEqual([]);
  });
});

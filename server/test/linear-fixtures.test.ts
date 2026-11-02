// The recorded Linear fixtures (#1444, D-7684's FX act, D-7743; spec 2026-10-31 §4.1, §6.7).
//
// `fixtures/linear/` holds one file per answer the FX capture recorded from Linear on 2026-11-02, scrubbed to the
// fixture vocabulary (README.md there says what was replaced and what was kept), plus ONE constructed answer, the
// rate-limited one, whose file name says so. This file holds three things of them:
//
//   1. EVERY FILE PARSES, and is one record of the capture's shape: the request it sent and the answer it got, the
//      raw body equal to the parsed one, the request body equal to the document and variables it names.
//   2. EVERY MERGED DOCUMENT IS RECORDED, BYTE FOR BYTE. Each `LINEAR_DOCUMENTS` constant (`ops.ts`) and the two
//      documents `client.ts` sends (the title lookup's and the key check's, read here off the fetch seam because
//      they are not exported) has a fixture whose `document` equals it. A document changed without a re-capture
//      turns this red, which is the rule the plan's FX item sets: a changed document is re-captured before it lands.
//   3. THE LEAK GUARD. These files are public. No fixture names an email outside `example.invalid`, a key other than
//      the `lin_api_fixture` shape, or a UUID outside the fixture set; the guard's own liveness rows prove it fires.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkLinearKey, lookupLinearIssue, verifyLinearKey, type FetchLike } from '../src/linear/client.js';
import { LINEAR_DOCUMENTS } from '../src/linear/ops.js';
import { LINEAR_QUOTA } from '../src/linear/rate.js';
import { linearAnswer } from './linearFetchFake.js';
import { LINEAR_RECORD_DIR, LINEAR_RECORD_FILES, linearRecord, recordedHeader as header, type LinearRecord } from './linearRecorded.js';

const FILES = LINEAR_RECORD_FILES;
// Every file, the README included: the leak guard reads them all.
const TEXT = new Map(readdirSync(LINEAR_RECORD_DIR).sort().map((f) => [f, readFileSync(path.join(LINEAR_RECORD_DIR, f), 'utf8')]));
const RECORDS = new Map<string, LinearRecord>(FILES.map((f) => [f, linearRecord(f)]));

describe('every fixture parses, one capture record each', () => {
  it('holds the recorded set and the one constructed answer', () => {
    // 31 recorded answers (the capture's cleanup and cleanup-verify calls are not kept) and the constructed 429.
    expect(FILES).toHaveLength(32);
    expect(FILES.filter((f) => f.includes('constructed'))).toEqual(['error-429-ratelimited-constructed.json']);
  });

  it.each(FILES)('%s is a whole record', (f) => {
    const r = RECORDS.get(f)!;
    expect(`${r.name}.json`).toBe(f);
    expect(typeof r.document).toBe('string');
    expect(typeof r.status).toBe('number');
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

  it.each(Object.entries(LINEAR_DOCUMENTS))('LINEAR_DOCUMENTS.%s', (_name, doc) => {
    expect(recorded(doc)).not.toEqual([]);
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
      for (const name of ['x-ratelimit-requests-reset', 'x-ratelimit-complexity-reset']) {
        const ahead = Number(header(r, name)) - r.sentAtMs;
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

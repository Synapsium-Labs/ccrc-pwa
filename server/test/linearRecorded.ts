/**
 * The recorded Linear answers, as a test reads them (#1444, the FX capture, D-7684, D-7743). `fixtures/linear/` holds one
 * file per answer Linear gave the capture (its README says what was scrubbed and what was kept); this is the one loader
 * of them, so every test that answers as Linear from a recording builds its answer here, with the status, the headers
 * and the body Linear sent, and none spells a header value or an error code of its own.
 *
 * Nothing here reaches the network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';

/** The directory of the recorded files. */
export const LINEAR_RECORD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'linear');

/** One capture record: the request it sent and the answer it got. */
export interface LinearRecord {
  name: string;
  documentSource: string;
  document: string;
  variables: Record<string, unknown>;
  requestBody: string;
  requestHeaders: string[];
  sentAtMs: number;
  receivedAtMs: number;
  sentAt: string;
  status: number;
  statusLine: string;
  headers: [string, string][];
  body: unknown;
  bodyRaw: string;
  note?: string;
  constructed?: string;
}

/** Every file name in the directory, sorted, `.json` only. */
export const LINEAR_RECORD_FILES: readonly string[] = readdirSync(LINEAR_RECORD_DIR).filter((f) => f.endsWith('.json')).sort();

const cache = new Map<string, LinearRecord>();

/** One record by its name (`read-issue`, with or without `.json`). Throws for a name the capture has no file for, so a
 *  test can never answer with a recording that does not exist. */
export function linearRecord(name: string): LinearRecord {
  const file = name.endsWith('.json') ? name : `${name}.json`;
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const r = JSON.parse(readFileSync(path.join(LINEAR_RECORD_DIR, file), 'utf8')) as LinearRecord;
  cache.set(file, r);
  return r;
}

/** A recorded response header, read case-insensitively, or null for one Linear did not send. */
export const recordedHeader = (r: LinearRecord, name: string): string | null =>
  r.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? null;

/** The answer a record holds, as the fetch seam returns it: its status, every header it carried, and its body. A fresh
 *  copy of the body each time, so a shaper can never change the recording. */
export function recordedAnswer(name: string): LinearAnswer {
  const r = linearRecord(name);
  const headers = Object.fromEntries(r.headers.map(([k, v]) => [k.toLowerCase(), v]));
  return linearAnswer({
    ok: r.status >= 200 && r.status < 300, status: r.status, headers,
    json: async () => JSON.parse(JSON.stringify(r.body)) as unknown,
  });
}

/** The recorded `X-Complexity` of a record, as a number, or null when the answer carried none (a 401). */
export const recordedComplexity = (name: string): number | null => {
  const v = recordedHeader(linearRecord(name), 'x-complexity');
  return v === null ? null : Number(v);
};

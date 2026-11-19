// D-8126 A4, fix round 1 (review 2792 F5): ONE owner of the call refusal sentences. Every refusal the digest's correction
// door can answer for a call line has a sentence in the console's call table (`CALL_REFUSAL_TEXT`, `callWords.ts`), so a
// code the door gains without a sentence reds here instead of reaching the operator as a bare slug. It lives in the
// server tree because a pwa test may not read `server/src` (ci-reach-census): a server-only change skips the pwa tests.
// The console's rendering of each sentence is pinned in pwa/test/digest-screen.test.tsx.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** The `why` codes of `DigestCorrectResult`, read from the door's own result type. */
const doorCodes = (): string[] => {
  const union = /export type DigestCorrectResult =[\s\S]*?why: ([^}]*)\}/.exec(read('server/src/coord/digest.ts'))?.[1] ?? '';
  return [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
};

/** The keys of the console's call refusal table. */
const tableCodes = (): string[] => {
  const body = /export const CALL_REFUSAL_TEXT[^=]*=\s*\{([\s\S]*?)\n\};/.exec(read('pwa/src/ledgers/callWords.ts'))?.[1] ?? '';
  return [...body.matchAll(/^\s*'([a-z-]+)':/gm)].map((m) => m[1]!);
};

/** Not a call's: the other row kinds' unknown rows, and the store's 503, which reads as the transport words. */
const NOT_A_CALLS = ['unknown-ask', 'unknown-approval', 'digest-unreadable'];

describe('the digest correction door\'s call refusals are said in the call table\'s words (D-8126)', () => {
  it('reads both sides', () => {
    expect(doorCodes()).toEqual(expect.arrayContaining(['unknown-call', 'not-coordinator', 'duplicate', ...NOT_A_CALLS]));
    expect(tableCodes()).toEqual(expect.arrayContaining(['unknown-call', 'not-coordinator', 'duplicate']));
  });

  it('every code the door answers for a call has a sentence in the call table', () => {
    const table = new Set(tableCodes());
    expect(doorCodes().filter((c) => !NOT_A_CALLS.includes(c) && !table.has(c))).toEqual([]);
  });
});

// CHARACTERIZATION (#1444, the Linear central key, its redactor task): what the three things this task moves or
// extends answer on `main`, pinned before any of them changes. Written green against the old code:
//   - the account audit's `actorOf` labels, which the unprintable set's move to one shared home must keep byte for
//     byte;
//   - the Linear key check's name cleaning (`cleanName`, reached through `verifyLinearKey`), which the move out of
//     `linear/client.ts` must keep; a later commit that builds it on the shared one-line strip names and re-points the
//     rows it changes, and only those;
//   - the egress and docs profiles of `shared/redact.mjs` over their corpora, which the new profile, the new prefix
//     and the counting entry point must leave as they are.
// The expected values are written out, never computed by the code under test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorOf } from '../src/accounts/audit.js';
import { verifyLinearKey, type FetchLike } from '../src/linear/client.js';
import { redact } from '../../shared/redact.js';
import { credentialMaskSource } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HASH = 'cd'.repeat(32);
const KEY = 'lin_api_fixturekey';

describe('actorOf: the account audit label, as main writes it', () => {
  const ROWS: [device: string | null, label: string][] = [
    ['a test phone', 'a test phone'],
    [null, 'unknown device'],
    ['', 'unknown device'],
    ['  two  spaces\there ', 'two spaces here'],
    ['line\none\u0007', 'line one'],
    ['\u009b31mevil\u202eabc\u200b\u2066x\u2069\ufeff\u0085y', '31mevil abc x y'],
    ['a\u2028b\u2029c', 'a b c'],
    ['\u00e9\u{1f600} ok', '\u00e9\u{1f600} ok'],
    [`${'x'.repeat(63)}\u202eyz`, 'x'.repeat(63)],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
    ['\u00a0nbsp\u00a0', 'nbsp'],
    ['a\u034fb', 'a b'],
    ['a\u061cb\u00adc\u180ed\u034fe\ufff9f\ufffbg\u{e0001}h\u{e0041}\u{e007f}i', 'a b c d e f g h i'],
    ['\u202e\u200f\u009b', 'unknown device'],
    ['x'.repeat(500), 'x'.repeat(64)],
  ];
  for (const [device, label] of ROWS) {
    it(JSON.stringify(device), () => {
      expect(actorOf(device, HASH).toString()).toBe(`${label} cdcdcdcd`);
      expect(actorOf(device, HASH).label).toBe(label);
    });
  }
});

describe('the Linear key check cleans a name as main does', () => {
  const nameOf = async (name: string): Promise<string> => {
    const f: FetchLike = async () => ({
      ok: true, status: 200, json: async () => ({ data: { viewer: { name }, organization: { name: 'org-a' } } }),
    });
    const r = await verifyLinearKey(KEY, { fetch: f });
    return r.ok ? r.user : r.reason;
  };
  const ROWS: [name: string, cleaned: string][] = [
    ['team-a', 'team-a'],
    [' team-a\n', 'team-a'],
    ['a\tb', 'a b'],
    ['a  b', 'a  b'],
    ['a\u202eb', 'a\u202eb'],
    ['a\u200bb', 'a\u200bb'],
    ['a\u2028b', 'a\u2028b'],
    ['\u0001x\u0002', 'x'],
    ['\u0001\u0002', 'malformed'],
    ['\u00e9\u{1f600}', '\u00e9\u{1f600}'],
    [`${'x'.repeat(79)}\u{1f600}y`, `${'x'.repeat(79)}\u{1f600}`],
    [`${'x'.repeat(78)} yy`, `${'x'.repeat(78)} y`],
    ['\u00a0a\u00a0', 'a'],
    ['a\u0085b', 'a b'],
  ];
  for (const [name, cleaned] of ROWS) {
    it(JSON.stringify(name), async () => { expect(await nameOf(name)).toBe(cleaned); });
  }
});

describe('shared/redact.mjs: the egress and docs profiles over their corpora, as main redacts them', () => {
  const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') };
  const EGRESS: { input: string; output: string }[] =
    JSON.parse(readFileSync(path.join(here, 'fixtures/approvals/redact-corpus.json'), 'utf8'));
  const DOCS: { docs: [string, string, string][]; cross: [string, string, string][] } =
    JSON.parse(readFileSync(path.join(here, 'fixtures/redact/profiles.json'), 'utf8'));
  it('the egress corpus, byte for byte', () => {
    expect(EGRESS.length).toBeGreaterThanOrEqual(196);
    expect(EGRESS.filter((r) => redact('egress', r.input, SHAPES) !== r.output).map((r) => r.input)).toEqual([]);
  });
  it('the docs corpus and the cross rows, byte for byte', () => {
    expect(DOCS.docs.filter(([, input, output]) => redact('docs', input) !== output).map(([why]) => why)).toEqual([]);
    const differ = ([input, egress, docs]: [string, string, string]): boolean =>
      redact('egress', input, SHAPES) !== egress || redact('docs', input) !== docs;
    expect(DOCS.cross.filter(differ).map(([input]) => input)).toEqual([]);
  });
});

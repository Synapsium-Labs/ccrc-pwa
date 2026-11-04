// A credential route's body errors and its `no-store` hook have one owner (desktop-polish carry, review 1389 A6, D-7950):
// `server/src/accounts/gate.ts`, whose `credentialBodyRoute` and `noStoreRoute` the stored secret's routes and the Linear
// connection's routes take. A second mapping of a body error to its fixed word, or Linear's own copy of either, is a
// second definition, and this file reds on it. KNOWN WIDTH: the mapping is found by its one spelling
// (`=== 413 ? 'oversize'`); a copy written another way is not seen. Other doors that set `no-store` for their own
// reasons (the token, step-up and proxy routes) are not credential-body routes and are not counted here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, rel } from './helpers.js';

const HOME = 'server/src/accounts/gate.ts';
const MAPPING = /=== 413 \? 'oversize'/;
const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');

describe('a credential route\'s body errors and no-store hook are defined once, in accounts/gate.ts (review 1389 A6)', () => {
  it('CONTROL: the pattern sees the mapping and passes over a use', () => {
    expect(MAPPING.test("refuseRoute(reply, err.statusCode === 413 ? 'oversize' : 'bad-request')")).toBe(true);
    expect(MAPPING.test('const write = credentialBodyRoute(PUT_BODY_LIMIT);')).toBe(false);
  });
  it('the body-error mapping is spelled in the home alone', () => {
    expect(ALL.filter((f) => MAPPING.test(readFileSync(f, 'utf8'))).map(rel).sort()).toEqual([HOME]);
  });
  it('the Linear routes and the ledger routes take both from the home, and Linear keeps no copy', () => {
    for (const f of ['server/src/linear/routes.ts', 'server/src/coord/ledgersRoutes.ts']) {
      expect(read(f), f).toMatch(/import \{[^}]*\bcredentialBodyRoute\b[^}]*\bnoStoreRoute\b[^}]*\} from '\.\.\/accounts\/gate\.js'/);
    }
    const linear = read('server/src/linear/routes.ts');
    expect(linear).not.toMatch(/\bbodyError\b/);
    expect(linear).not.toMatch(/\bNO_STORE\b/);
    expect(linear).not.toMatch(/header\('cache-control'/);
  });
});

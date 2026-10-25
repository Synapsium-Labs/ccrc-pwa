// ARCH-13b (#557): the refusal tables live in `lib/refusalWords.ts`, read through ONE function, and `lib/api.ts`
// is the transport only. The characterization file next to this one pins the sentences themselves.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import {
  ASK_REFUSE_TEXT, INTERRUPT_REFUSAL_TEXT, RUN_ROUTE_REFUSAL_TEXT, SET_ACCOUNT_POOLS_REFUSAL_TEXT, refusalText,
} from '../src/lib/refusalWords';
import * as api from '../src/lib/api';
import * as words from '../src/lib/refusalWords';
import {
  ASK_REFUSE_CODES, INTERRUPT_REFUSALS, RUN_ROUTE_REFUSE_CODES, SET_ACCOUNT_POOLS_REFUSE_CODES,
} from '../../shared/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const err = (body: unknown): ApiError => new ApiError(409, body);

describe('the four tables are total over their unions (ARCH-13b)', () => {
  // tsc already refuses a missing member (each is a `Record<Union, string>`); this is the runtime half, so a table
  // that gained a key the union dropped, or an empty sentence, fails too.
  it.each([
    ['InterruptRefusal', INTERRUPT_REFUSAL_TEXT, INTERRUPT_REFUSALS],
    ['RunRouteRefuseCode', RUN_ROUTE_REFUSAL_TEXT, RUN_ROUTE_REFUSE_CODES],
    ['AskRefuseCode', ASK_REFUSE_TEXT, ASK_REFUSE_CODES],
    ['SetAccountPoolsRefuseCode', SET_ACCOUNT_POOLS_REFUSAL_TEXT, SET_ACCOUNT_POOLS_REFUSE_CODES],
  ] as const)('%s: one non-empty sentence per member, and no other key', (_name, table, codes) => {
    expect(Object.keys(table).sort()).toEqual([...codes].sort());
    for (const code of codes) expect((table as Record<string, string>)[code]!.trim()).not.toBe('');
  });
});

describe('refusalText', () => {
  it('reads the code off the body and answers the table\'s sentence', () => {
    expect(refusalText(err({ error: 'not-busy' }), INTERRUPT_REFUSAL_TEXT)).toBe(INTERRUPT_REFUSAL_TEXT['not-busy']);
    expect(refusalText(err({ error: 'ceiling' }), RUN_ROUTE_REFUSAL_TEXT)).toBe(RUN_ROUTE_REFUSAL_TEXT.ceiling);
  });

  it('never falls back to the raw code: a code the table does not own is null', () => {
    expect(refusalText(err({ error: 'floor' }), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(err({ error: 'never-heard-of-it' }), ASK_REFUSE_TEXT)).toBeNull();
  });

  it('owns only its own keys: an inherited name is not a code', () => {
    expect(refusalText(err({ error: 'toString' }), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(err({ error: '__proto__' }), INTERRUPT_REFUSAL_TEXT)).toBeNull();
  });

  it('is null for anything that is not an ApiError with a coded body', () => {
    expect(refusalText(new Error('not-busy'), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(err('not-busy'), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(err(null), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(err({ error: 7 }), INTERRUPT_REFUSAL_TEXT)).toBeNull();
    expect(refusalText(null, INTERRUPT_REFUSAL_TEXT)).toBeNull();
  });
});

describe('where the copy lives', () => {
  it('lib/api.ts re-exports every refusalWords export, so no importer moved', () => {
    for (const name of Object.keys(words)) {
      expect(Object.hasOwn(api, name), `lib/api.ts no longer exports ${name}`).toBe(true);
      expect((api as Record<string, unknown>)[name]).toBe((words as Record<string, unknown>)[name]);
    }
  });

  it('lib/api.ts holds no text table of its own', () => {
    const src = readFileSync(path.join(here, '../src/lib/api.ts'), 'utf8');
    expect(src.match(/^(?:export )?const [A-Z_]+_TEXT\b/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/^(?:export )?function \w*Text\(/m);
  });
});

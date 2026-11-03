// D-7569 (ARCH-05, #551): `lib/api.ts`, the fetch adapter, re-exports the API client's error class from its leaf
// `lib/apiError.ts` and the refusal words from their leaf `lib/refusalWords.ts`. An L1 module that needs one of
// them imports it from the leaf, never from the adapter. A re-export is the same binding, so every caller sees one
// class and one function whichever path it imported.
//
// The `toBe` rows hold the bindings. They cannot see a refusal-words module that branches on a class of its own,
// because every exported binding would still be the same one; the behaviour rows can. This file imports from both
// paths, so it holds unedited before and after each L1 module is re-pointed at a leaf.
import { describe, expect, it } from 'vitest';
import * as api from '../src/lib/api';
import * as apiErrorLeaf from '../src/lib/apiError';
import * as refusalWordsLeaf from '../src/lib/refusalWords';

const POOL_NAME_SENTENCE =
  'A pool name starts with a lowercase letter and holds only lowercase letters, digits and hyphens.';

describe('lib/api.ts re-exports its leaves, one binding each', () => {
  it.each([
    ['ApiError', api.ApiError, apiErrorLeaf.ApiError],
    ['apiErrorText', api.apiErrorText, refusalWordsLeaf.apiErrorText],
    ['failedTo', api.failedTo, refusalWordsLeaf.failedTo],
    ['sendErrorText', api.sendErrorText, refusalWordsLeaf.sendErrorText],
  ] as const)('%s from lib/api.ts is the leaf\'s own export', (_name, viaAdapter, viaLeaf) => {
    expect(typeof viaLeaf).toBe('function');
    expect(viaAdapter).toBe(viaLeaf);
  });
});

describe('the refusal words branch on the one error class', () => {
  it('apiErrorText answers the sentence, not the bare code, for an error built through lib/api.ts', () => {
    const err = new api.ApiError(400, { ok: false, error: 'bad-pool-name' });
    const text = api.apiErrorText(err);
    expect(text).toBe(POOL_NAME_SENTENCE);
    expect(text).not.toBe('bad-pool-name');
  });

  it('failedTo puts that sentence after its verb for an error built from the leaf', () => {
    const err = new apiErrorLeaf.ApiError(400, { ok: false, error: 'bad-pool-name' });
    expect(refusalWordsLeaf.failedTo('rename', err)).toBe(`Couldn't rename — ${POOL_NAME_SENTENCE}`);
  });
});

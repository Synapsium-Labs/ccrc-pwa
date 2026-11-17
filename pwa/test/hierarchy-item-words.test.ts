// D-8182: the hierarchy item route (`POST /api/items/:id/linear`) refuses `item-act-mismatch` when an item's action does
// not take the act. The console answers every refusal word with a fixed sentence, never the bare word.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import { apiErrorText } from '../src/lib/refusalWords';

describe('the console\'s sentence for item-act-mismatch', () => {
  it('is a fixed sentence, not the word itself', () => {
    const text = apiErrorText(new ApiError(409, { ok: false, error: 'item-act-mismatch' }));
    expect(text).not.toBe('item-act-mismatch');
    expect(text).toBe('That item does not take this action, so nothing was changed. Reload the item and choose again.');
  });
});

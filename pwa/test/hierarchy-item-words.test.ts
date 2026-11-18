// D-8182: the hierarchy item route (`POST /api/items/:id/linear`) refuses `item-act-mismatch` when an item's action does
// not take the act. The console answers every refusal word with a fixed sentence, never the bare word. D-8183 adds the inbound
// path's two: `plan triage` answers `not-linear-owner`, and `plan triage` and `plan take` answer `issue-not-inbound`.
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

describe('the console\'s sentences for the inbound path\'s two words (D-8183)', () => {
  it('not-linear-owner and issue-not-inbound are fixed sentences, not the words themselves', () => {
    const owner = apiErrorText(new ApiError(403, { ok: false, error: 'not-linear-owner' }));
    expect(owner).not.toBe('not-linear-owner');
    expect(owner).toBe('Only the Linear owner of this team decides what becomes of an issue filed in Linear, so nothing was changed. Ask the owner, or name another one on the project.');
    const inbound = apiErrorText(new ApiError(409, { ok: false, error: 'issue-not-inbound' }));
    expect(inbound).not.toBe('issue-not-inbound');
    expect(inbound).toBe('That issue is not waiting for this decision: it was already decided, or it was not handed to you. Nothing was changed.');
  });
});

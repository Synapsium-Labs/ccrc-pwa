// A prompt refused `409 renewing` (Overlord W1a hand-offs): the session is between conversations, nothing was typed, and
// the failed pending bubble keeps the message with its sentence, so Retry resends it and nothing is lost.
import { describe, expect, it, vi } from 'vitest';
import { ApiError, sendErrorText } from '../src/lib/api';
import { createSessionStore } from '../src/stores/session';

const SENTENCE = 'Between conversations (starting or renewing) — your message is kept; send it again in a moment.';

describe('a send refused `renewing`', () => {
  it('keeps the message as a failed pending send, with the code and the sentence', async () => {
    const prompt = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'renewing' }));
    const store = createSessionStore('s1', { api: { prompt } });
    await store.getState().send('please carry on');
    expect(store.getState().pending).toEqual([
      expect.objectContaining({ text: 'please carry on', state: 'failed', code: 'renewing', error: SENTENCE }),
    ]);
  });

  it('Retry resends the same text', async () => {
    const prompt = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'renewing' }))
      .mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt } });
    await store.getState().send('please carry on');
    store.getState().retry(store.getState().pending[0]!.key);
    await Promise.resolve();
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1]![1]).toBe('please carry on');
  });

  it('the sentence table names it', () => {
    expect(sendErrorText('renewing')).toBe(SENTENCE);
  });
});

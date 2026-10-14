// The parse worker's protocol (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and runner").
// `answerMarkdownJob` is everything the worker does with one message: `{id, src, profile}` in, `{id, outcome}` out,
// with both the parse and the post wrapped, so a reply the structured clone refuses (a `DataCloneError`) answers
// `threw` instead of leaving the runner to wait out its budget. The worker entry itself is imported once, under a
// stubbed `self`, to prove it assigns `onmessage` to `answerMarkdownJob` and answers through the worker's own post.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerMarkdownJob, parseMarkdown, type MarkdownReply } from '../src/lib/markdownParse';
import * as guard from '../src/lib/markdownGuard';

/** A `post` that records every reply it is given. */
function recorder(): { replies: MarkdownReply[]; post: (reply: MarkdownReply) => void } {
  const replies: MarkdownReply[] = [];
  return { replies, post: (reply) => { replies.push(reply); } };
}

describe('answerMarkdownJob', () => {
  it('answers with the job id and the outcome parseMarkdown gives for its src', () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 7, src: '# hi', profile: 'chat' }, post);
    expect(replies).toEqual([{ id: 7, outcome: parseMarkdown('# hi', 'chat') }]);
    expect(replies[0]?.outcome.kind).toBe('tree');
  });

  it("answers a 'docs' job the same way", () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 8, src: '> [!NOTE]\n> a', profile: 'docs' }, post);
    expect(replies).toEqual([{ id: 8, outcome: parseMarkdown('> [!NOTE]\n> a', 'docs') }]);
  });

  it('answers a pre-scan refusal like any other outcome', () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 9, src: '>'.repeat(10000) + ' x', profile: 'chat' }, post);
    expect(replies).toEqual([{ id: 9, outcome: { kind: 'refused', why: 'container-depth', line: 1, value: 10000 } }]);
  });

  it.each([
    ['a missing src', { id: 1, profile: 'chat' }],
    ['a numeric src', { id: 1, src: 42, profile: 'chat' }],
    ['a missing profile', { id: 1, src: 'x' }],
    ['an unknown profile', { id: 1, src: 'x', profile: 'wiki' }],
    ['an inherited name as the profile', { id: 1, src: 'x', profile: 'toString' }],
  ])('%s answers threw TypeError under the job id', (_name, job) => {
    const { replies, post } = recorder();
    answerMarkdownJob(job, post);
    expect(replies).toEqual([{ id: 1, outcome: { kind: 'threw', error: 'TypeError' } }]);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 1],
    ['an object with no id', { src: 'x', profile: 'chat' }],
    ['a string id', { id: '1', src: 'x', profile: 'chat' }],
    ['a NaN id', { id: Number.NaN, src: 'x', profile: 'chat' }],
    ['an infinite id', { id: Number.POSITIVE_INFINITY, src: 'x', profile: 'chat' }],
  ])('a message with %s is dropped: there is no id to answer to', (_name, data) => {
    const { replies, post } = recorder();
    answerMarkdownJob(data, post);
    expect(replies).toEqual([]);
  });

  it('a post that throws a DataCloneError answers once more, threw DataCloneError, under the same id', () => {
    const replies: MarkdownReply[] = [];
    let calls = 0;
    answerMarkdownJob({ id: 3, src: 'x', profile: 'chat' }, (reply) => {
      calls += 1;
      if (calls === 1) throw new DOMException('could not be cloned', 'DataCloneError');
      replies.push(reply);
    });
    expect(calls).toBe(2);
    expect(replies).toEqual([{ id: 3, outcome: { kind: 'threw', error: 'DataCloneError' } }]);
  });

  it("a post that throws twice is swallowed: the runner's budget answers that job", () => {
    const post = vi.fn((_reply: MarkdownReply): void => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    });
    expect(() => answerMarkdownJob({ id: 4, src: 'x', profile: 'chat' }, post)).not.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('the worker entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('assigns self.onmessage, which answers each job through self.postMessage', async () => {
    const posted: unknown[] = [];
    const fakeSelf: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = {
      onmessage: null,
      postMessage: (m) => { posted.push(m); },
    };
    vi.stubGlobal('self', fakeSelf);
    await import('../src/lib/markdownWorker');
    expect(fakeSelf.onmessage).toBeTypeOf('function');
    fakeSelf.onmessage?.({ data: { id: 1, src: '# hi', profile: 'docs' } });
    fakeSelf.onmessage?.({ data: { id: 2, src: 42, profile: 'chat' } });
    expect(posted).toEqual([
      { id: 1, outcome: parseMarkdown('# hi', 'docs') },
      { id: 2, outcome: { kind: 'threw', error: 'TypeError' } },
    ]);
  });
});

describe('T11 review A-4: a throw from the pre-scan answers threw, not a worker error', () => {
  it('a pre-scan that throws answers threw with the error name only, once, under the job id', () => {
    const spy = vi.spyOn(guard, 'prescanMarkdown').mockImplementation(() => {
      throw new RangeError('secret detail from the scan');
    });
    try {
      const { replies, post } = recorder();
      expect(() => answerMarkdownJob({ id: 5, src: 'x', profile: 'chat' }, post)).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(replies).toEqual([{ id: 5, outcome: { kind: 'threw', error: 'RangeError' } }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a non-string src answers threw TypeError without reaching the pre-scan, so the wrap is not what says it', () => {
    const spy = vi.spyOn(guard, 'prescanMarkdown');
    try {
      const { replies, post } = recorder();
      answerMarkdownJob({ id: 6, src: 42, profile: 'chat' }, post);
      expect(spy).not.toHaveBeenCalled();
      expect(replies).toEqual([{ id: 6, outcome: { kind: 'threw', error: 'TypeError' } }]);
    } finally {
      spy.mockRestore();
    }
  });
});

// A transcript row's equality (desktop polish Task C7). `buildChatItems` builds every item again on each events frame,
// while the events themselves keep their identity (`dedupeAppend`), so the list's row barrier compares a row by its
// fields: the same event is the same row, a mail item's envelope and a task item's notification are read off that event,
// and a folded tool group is the same row when its entries are, element by element.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { sameRowProps, sameTranscriptItem } from '../src/session/sameRow';
import { groupToolRun, type TranscriptItem } from '../src/session/toolSummary';

const TS = '2026-10-28T10:00:00.000Z';
const assistant = (uuid: string, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const toolUse = (toolId: string, name = 'Read', input = '{"file_path":"/w/project-a/a.ts"}'): ChatEvent =>
  ({ kind: 'tool_use', uuid: `u-${toolId}`, ts: TS, toolId, name, input });
const toolResult = (toolId: string, text = 'ok'): ChatEvent => ({ kind: 'tool_result', ts: TS, toolId, text, isError: false });
const mailTurn = (uuid: string): ChatEvent => ({
  kind: 'user', uuid, ts: TS, text: [
    '```' + MAIL_ENVELOPE_FENCE, 'id: 17', 'from: coordinator', 'to: worker-a', 'kind: status', 'subject: wave-brief',
    'ack: ccrc-api mail ack 17 (a delivery id).', '  Ack it promptly.', '--', 'Implement Tasks 1-3 in order.', '```',
  ].join('\n'),
});

/** The one item of `kind` that `events` builds to. */
function only<K extends TranscriptItem['kind']>(items: readonly TranscriptItem[], kind: K): Extract<TranscriptItem, { kind: K }> {
  const found = items.filter((i) => i.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as Extract<TranscriptItem, { kind: K }>;
}

describe('sameTranscriptItem', () => {
  it('a rebuilt item with the same event is the same row', () => {
    const events = [assistant('a1', 'hello')];
    const a = only(buildChatItems(events, []), 'message');
    const b = only(buildChatItems(events, []), 'message');
    expect(a).not.toBe(b);
    expect(sameTranscriptItem(a, b)).toBe(true);
    // A different event with the same words is a different row: identity, never content.
    const c = only(buildChatItems([assistant('a1', 'hello')], []), 'message');
    expect(sameTranscriptItem(a, c)).toBe(false);
  });

  it('a rebuilt mail item is the same row', () => {
    const events = [mailTurn('m1')];
    const a = only(buildChatItems(events, []), 'mail');
    const b = only(buildChatItems(events, []), 'mail');
    // The envelope is parsed again on every build: a new object read off the same event.
    expect(a.envelope).not.toBe(b.envelope);
    expect(sameTranscriptItem(a, b)).toBe(true);
  });

  it('a rebuilt tool group with the same entries is the same row', () => {
    const events = [toolUse('t1'), toolResult('t1'), toolUse('t2', 'Read', '{"file_path":"/w/project-a/b.ts"}'), toolResult('t2')];
    const a = only(groupToolRun(buildChatItems(events, [])), 'tool-group');
    const b = only(groupToolRun(buildChatItems(events, [])), 'tool-group');
    expect(a.entries).not.toBe(b.entries);
    expect(a.entries).toHaveLength(2);
    expect(sameTranscriptItem(a, b)).toBe(true);
  });

  it('a tool item whose result arrived is a different row', () => {
    const use = toolUse('t1', 'Bash', '{"command":"npm test"}');
    const a = only(buildChatItems([use], []), 'tool');
    const b = only(buildChatItems([use, toolResult('t1')], []), 'tool');
    expect(a.result).toBeUndefined();
    expect(sameTranscriptItem(a, b)).toBe(false);
  });

  it('a group with one changed entry is a different row', () => {
    const r2 = toolResult('t2');
    const base = [toolUse('t1'), toolResult('t1'), toolUse('t2', 'Read', '{"file_path":"/w/project-a/b.ts"}')];
    const a = only(groupToolRun(buildChatItems([...base, r2], [])), 'tool-group');
    // The second entry's result is another event: the same group key, the same length, one entry different.
    const b = only(groupToolRun(buildChatItems([...base, toolResult('t2')], [])), 'tool-group');
    expect(a.key).toBe(b.key);
    expect(sameTranscriptItem(a, b)).toBe(false);
  });

  it('two items of different kinds or keys are never the same row', () => {
    const items: ChatItem[] = buildChatItems([assistant('a1', 'x'), assistant('a2', 'x')], []);
    const [first, second] = items.filter((i) => i.kind === 'message');
    expect(sameTranscriptItem(first!, second!)).toBe(false);
    expect(sameTranscriptItem({ kind: 'working', key: 'working' }, { kind: 'working', key: 'working' })).toBe(true);
    expect(sameTranscriptItem({ kind: 'working', key: 'working' }, first!)).toBe(false);
  });
});

describe('sameRowProps', () => {
  const onRetry = (): void => {};
  it('compares the item by sameTranscriptItem and every other prop by identity', () => {
    const events = [assistant('a1', 'hello')];
    const a = { item: only(buildChatItems(events, []), 'message'), id: 's', onRetry, askBelow: false };
    const b = { item: only(buildChatItems(events, []), 'message'), id: 's', onRetry, askBelow: false };
    expect(sameRowProps(a, b)).toBe(true);
    expect(sameRowProps(a, { ...b, askBelow: true })).toBe(false);
    expect(sameRowProps(a, { ...b, onRetry: (): void => {} })).toBe(false);
    expect(sameRowProps(a, { ...b, item: only(buildChatItems([assistant('a1', 'hello')], []), 'message') })).toBe(false);
  });
});

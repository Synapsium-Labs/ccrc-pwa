// A transcript row's equality (desktop polish Task C7). `buildChatItems` builds every item again on each events frame,
// while the events themselves keep their identity (`dedupeAppend`), so the list's row barrier compares a row by its
// fields: the same event is the same row, a mail item's envelope and a task item's notification are read off that event,
// and a folded tool group is the same row when its entries are, element by element. A tool-activity row (desktop polish
// wave 168) is the same row when its entries, its opened rows and what it surfaces are, element by element, and its
// words and flags are the same; any change to what it shows is a new row.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { readsClock, sameRowProps, sameTranscriptItem } from '../src/session/sameRow';
import { foldToolActivity, type ActivityFold, type TranscriptItem } from '../src/session/toolActivity';
import { groupToolRun } from '../src/session/toolSummary';

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
/** A finished background task's report, a system row (`task-card.test.tsx`'s fixture). */
const taskRow = (uuid: string): ChatEvent => ({
  kind: 'system', uuid, ts: TS, text: '<task-notification>\n<task-id>w0s3mcrji</task-id>\n'
    + '<tool-use-id>toolu_01Qj6Dyd</tool-use-id>\n<status>completed</status>\n'
    + '<summary>Dynamic workflow "resolve the six design forks" completed</summary>\n'
    + '<result>{"verdict":"shippable"}</result>\n</task-notification>',
});
const limitRow = (uuid: string): ChatEvent =>
  ({ kind: 'system', uuid, ts: TS, text: 'limit', origin: 'limit', resetsAt: 1_793_181_600 });

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

  it('a rebuilt task item is the same row', () => {
    const events = [taskRow('n1')];
    const a = only(buildChatItems(events, []), 'task');
    const b = only(buildChatItems(events, []), 'task');
    // The notification is parsed again on every build: a new object read off the same event.
    expect(a.notification).not.toBe(b.notification);
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

describe('readsClock, and the day a row compares (review 1128)', () => {
  it('only a usage-limit pill with a reset time reads the clock', () => {
    expect(readsClock(only(buildChatItems([limitRow('l1')], []), 'message'))).toBe(true);
    const { resetsAt: _, ...noTime } = limitRow('l2') as Extract<ChatEvent, { kind: 'system' }>;
    expect(readsClock(only(buildChatItems([noTime], []), 'message'))).toBe(false);
    expect(readsClock(only(buildChatItems([assistant('a1', 'hello')], []), 'message'))).toBe(false);
    expect(readsClock(only(buildChatItems([taskRow('n1')], []), 'task'))).toBe(false);
    expect(readsClock({ kind: 'working', key: 'working' })).toBe(false);
  });

  it('a new day is a new row only where the row reads the clock', () => {
    const limit = [limitRow('l1')];
    const pill = { item: only(buildChatItems(limit, []), 'message'), id: 's', day: 'day-1' };
    expect(sameRowProps(pill, { ...pill, item: only(buildChatItems(limit, []), 'message') })).toBe(true);
    expect(sameRowProps(pill, { ...pill, day: 'day-2' })).toBe(false);
    const prose = [assistant('a1', 'hello')];
    const message = { item: only(buildChatItems(prose, []), 'message'), id: 's', day: 'day-1' };
    expect(sameRowProps(message, { ...message, day: 'day-2' })).toBe(true);
    // The day is the only prop a row may skip: any other change is still a new row.
    expect(sameRowProps(message, { ...message, id: 't' })).toBe(false);
  });
});

describe('a tool-activity row (desktop polish wave 168)', () => {
  const failedResult = (toolId: string): ChatEvent => ({ kind: 'tool_result', ts: TS, toolId, text: 'exit 1', isError: true });
  const events = (): ChatEvent[] => [
    { kind: 'user', uuid: 'q1', ts: TS, text: 'Go.' },
    assistant('a1', 'Reading.'),
    toolUse('t1'), toolResult('t1'),
    toolUse('t2', 'Bash', '{"command":"npm test"}'),
  ];
  const row = (evs: ChatEvent[], fold: Partial<ActivityFold> = {}) =>
    only(foldToolActivity(buildChatItems(evs, [], true), { runs: 'tool-runs', wait: { kind: 'none' }, busy: true, ...fold }), 'tool-activity');

  it('a freshly built row over the same events is the same row, its arrays new', () => {
    const evs = events();
    const a = row(evs);
    const b = row(evs);
    expect(a.entries).not.toBe(b.entries);
    expect(a.inner).not.toBe(b.inner);
    expect(a.attention).not.toBe(b.attention);
    expect(sameTranscriptItem(a, b)).toBe(true);
    // The same with a surfaced failure and a live wait in it.
    const failing = [...evs.slice(0, 3), failedResult('t1'), evs[4]!];
    expect(sameTranscriptItem(row(failing, { wait: { kind: 'other' } }), row(failing, { wait: { kind: 'other' } }))).toBe(true);
  });

  it('a row whose live state, wait or surfaced entries changed is a different row', () => {
    const evs = events();
    // The turn ended: no longer running, nothing else changed.
    const running = row(evs, { busy: true });
    const ended = row(evs, { busy: false });
    expect([running.live, ended.live]).toEqual([true, false]);
    expect(sameTranscriptItem(running, ended)).toBe(false);
    // The session began to wait on the reader.
    expect(sameTranscriptItem(row(evs), row(evs, { wait: { kind: 'other' } }))).toBe(false);
    // A failure arrived: the same entries by key, a different result, and a new surfaced entry.
    const failing = [...evs.slice(0, 3), failedResult('t1'), evs[4]!];
    expect(sameTranscriptItem(row(evs), row(failing))).toBe(false);
    // A call arrived.
    expect(sameTranscriptItem(row(evs), row([...evs, toolUse('t3')]))).toBe(false);
    // The session began asking the turn's one open question: the same calls, a surfaced card now.
    const asking: ChatEvent[] = [...evs.slice(0, 4), toolUse('t4', 'AskUserQuestion', '{"questions":[{"question":"Ship?"}]}')];
    const quiet = row(asking);
    const asked = row(asking, { wait: { kind: 'question', questions: ['Ship?'] } });
    expect([quiet.attention.length, asked.attention.length, quiet.waiting, asked.waiting]).toEqual([0, 1, false, false]);
    expect(sameTranscriptItem(quiet, asked)).toBe(false);
    // The reader prompted again: the turn is over, so the row's calls are settled (review 3478 F4), and nothing else changed.
    const done = row(evs, { busy: false });
    const prompted = row([...evs, { kind: 'user', uuid: 'q2', ts: TS, text: 'Next.' }], { busy: false });
    expect([done.past, prompted.past, done.live, prompted.live]).toEqual([false, true, false, false]);
    expect(sameTranscriptItem(done, prompted)).toBe(false);
    // The skin's inner grouping changed (a switch): the same calls, other opened rows.
    expect(sameTranscriptItem(row(evs, { runs: 'tool-runs' }), row(evs, { runs: 'none' }))).toBe(false);
  });
});

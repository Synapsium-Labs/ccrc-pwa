// A tool stretch across an older page's join (desktop polish wave 175, fix round 1 F2; `session/stretchJoin.ts`): which
// stretch a vanished key became, read off the two lists, and the reader's open stretch kept open across the join. Built
// from the real fold, so a stretch's key is what the list draws.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { buildChatItems } from '../src/session/chatItems';
import { foldToolActivity, type TranscriptItem } from '../src/session/toolActivity';
import { expansionMemo } from '../src/session/transcriptRow';
import { keepOpenAcross, renamedAcross } from '../src/session/stretchJoin';

const TS = '2026-11-24T10:00:00.000Z';
const call = (n: string): ChatEvent[] => [
  { kind: 'tool_use', uuid: `u${n}`, ts: TS, toolId: `t${n}`, name: 'Bash', input: JSON.stringify({ command: `step ${n}` }) },
  { kind: 'tool_result', ts: TS, toolId: `t${n}`, text: 'ok', isError: false },
];
const say = (uuid: string): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text: uuid });
const fold = (events: ChatEvent[]): TranscriptItem[] =>
  foldToolActivity(buildChatItems(events, [], false), { runs: 'none', wait: { kind: 'none' }, busy: false });
const stretch = (items: readonly TranscriptItem[]): TranscriptItem => items.find((i) => i.kind === 'tool-activity')!;

/** The rows held: a stretch of three calls at the top, then a message. */
const held = [...call('3'), ...call('4'), ...call('5'), say('m1')];

describe('renamedAcross', () => {
  it('a page of calls only joins the top stretch: its key changes and no other row comes; old key to new', () => {
    const was = fold(held);
    const now = fold([...call('1'), ...call('2'), ...held]);
    expect(now).toHaveLength(was.length);
    expect(stretch(now).key).not.toBe(stretch(was).key);
    expect([...renamedAcross(was, now)]).toEqual([[stretch(was).key, stretch(now).key]]);
  });

  it('a page with a message before its calls: the stretch still joins, and the rename is the same', () => {
    const was = fold(held);
    const now = fold([say('p0'), ...call('2'), ...held]);
    expect([...renamedAcross(was, now)]).toEqual([[stretch(was).key, stretch(now).key]]);
  });

  it('nothing renamed when no stretch key vanished, or the stretch is not at the join', () => {
    const was = fold(held);
    expect(renamedAcross(was, was).size).toBe(0);
    expect(renamedAcross(was, fold([say('p0'), say('p1'), ...held])).size).toBe(0);
    expect(renamedAcross([], fold(held)).size).toBe(0);
  });
});

describe('keepOpenAcross', () => {
  it('the stretch the reader had open stays open under its new key', () => {
    const was = fold(held);
    const now = fold([...call('1'), ...held]);
    const memo = expansionMemo();
    memo.set(stretch(was).key, true);
    keepOpenAcross(was, now, memo);
    expect(memo.get(stretch(now).key)).toBe(true);
  });

  it('a stretch the reader had closed stays closed', () => {
    const was = fold(held);
    const now = fold([...call('1'), ...held]);
    const memo = expansionMemo();
    keepOpenAcross(was, now, memo);
    expect(memo.get(stretch(now).key)).toBe(false);
  });

  it('a stretch that kept its key is left as the reader set it', () => {
    const was = fold(held);
    const now = fold([say('p0'), say('p1'), ...held]);
    const memo = expansionMemo();
    memo.set(stretch(was).key, true);
    keepOpenAcross(was, now, memo);
    expect(memo.get(stretch(now).key)).toBe(true);
    expect(stretch(now).key).toBe(stretch(was).key);
  });
});

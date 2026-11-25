// A tool stretch across an older page's join (desktop polish wave 175, fix round 1 F2; `session/stretchJoin.ts`): which
// stretch a vanished key became, read off the two lists, and the reader's open stretch kept open across the join. Built
// from the real fold, so a stretch's key is what the list draws.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { buildChatItems } from '../src/session/chatItems';
import { foldMailRows } from '../src/session/mailRows';
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

// ---- the mail rows across a join (wave 176's fold, absorbed in fix round 2) ---------------------------------------------
const SELF = 'lane-a-project-a';
/** The list as it is drawn: the chat items, the mail fold, then the tool fold. */
const drawn = (events: ChatEvent[]): TranscriptItem[] =>
  foldToolActivity(foldMailRows(buildChatItems(events, [], false), SELF), { runs: 'none', wait: { kind: 'none' }, busy: false });
/** The mail lane's prompt: a user turn opening with its fixed head. */
const prompt = (uuid: string): ChatEvent => ({ kind: 'user', uuid, ts: TS, text: `${INJECTED_PROMPTS['mail-nudge'].text} Use the client.` });
const ofKind = (items: readonly TranscriptItem[], kind: string): TranscriptItem => items.find((i) => i.kind === kind)!;
/** A fetch's result, the envelope as a transcript holds it: a card of its own when its call is not drawn with it. */
const fetched = (n: string): ChatEvent => ({
  kind: 'tool_result', ts: TS, toolId: `t${n}`, isError: false,
  text: '```' + MAIL_ENVELOPE_FENCE + `\nid: 17\nfrom: coordinator\nto: ${SELF}\nkind: status\nsubject: wave-brief\n`
    + 'ack: ccrc-api mail ack 17 --json -   (17 is this DELIVERY id, not the\n--\nDo the wave.\n```',
});

describe('a run of mail prompts across a join', () => {
  it('a page of prompts joins the top run: the run is renamed, and the run the reader had open stays open', () => {
    const was = drawn([prompt('p2'), prompt('p3'), say('m1')]);
    const now = drawn([prompt('p1'), prompt('p2'), prompt('p3'), say('m1')]);
    const [run0, run1] = [ofKind(was, 'mail-prompts'), ofKind(now, 'mail-prompts')];
    expect(run1.key).not.toBe(run0.key);
    expect(now).toHaveLength(was.length); // no row added: the run grew at its top
    expect([...renamedAcross(was, now)]).toEqual([[run0.key, run1.key]]);
    const memo = expansionMemo();
    memo.set(run0.key, true);
    keepOpenAcross(was, now, memo);
    expect(memo.get(run1.key)).toBe(true);
  });

  it('a lone prompt at the top becomes a run: the prompt the reader had open opens the run', () => {
    const was = drawn([prompt('p2'), say('m1')]);
    const now = drawn([prompt('p1'), prompt('p2'), say('m1')]);
    const lone = ofKind(was, 'mail-prompt');
    const run = ofKind(now, 'mail-prompts');
    expect([...renamedAcross(was, now)]).toEqual([[lone.key, run.key]]);
    const memo = expansionMemo();
    memo.set(lone.key, true);
    keepOpenAcross(was, now, memo);
    expect(memo.get(run.key)).toBe(true);
  });

  it('a closed run stays closed', () => {
    const was = drawn([prompt('p2'), prompt('p3'), say('m1')]);
    const now = drawn([prompt('p1'), prompt('p2'), prompt('p3'), say('m1')]);
    const memo = expansionMemo();
    keepOpenAcross(was, now, memo);
    expect(memo.get(ofKind(now, 'mail-prompts').key)).toBe(false);
  });
});

describe('a fetched mail card standing alone at the top, taken into a stretch by a join', () => {
  it('the hold follows the card to the stretch that took it; the card\'s own open state is never the stretch\'s', () => {
    // The fetch's call is in the older page: the rows held open with its result, a card on its own.
    const [use] = call('9');
    const was = drawn([fetched('9'), say('m1')]);
    const now = drawn([...call('8'), use!, fetched('9'), say('m1')]);
    const card = ofKind(was, 'mail');
    const into = ofKind(now, 'tool-activity');
    expect(now.some((i) => i.key === card.key), 'the card still stands alone').toBe(false);
    expect(renamedAcross(was, now).get(card.key)).toBe(into.key);
    const memo = expansionMemo();
    memo.set(card.key, true); // a card drawn open records that as its choice
    keepOpenAcross(was, now, memo);
    expect(memo.get(into.key), 'an open card opened the stretch that took it').toBe(false);
    expect(memo.get(card.key)).toBe(true);
  });
});

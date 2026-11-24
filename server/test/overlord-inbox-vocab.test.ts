// The inbox's vocabulary and codecs (Overlord W1, inbox piece, Task 1; `shared/overlordInbox.ts`, L0). The codecs' cases live in
// `./sim/overlordInboxSets.ts`, where `sim/mutation-floors.test.ts` runs them against every mutant too; here they run
// against the real module, beside the tests of the vocabulary's own shape.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { PROBE_ROUND_KINDS } from '../../shared/continuity.js';
import { OPERATOR_MESSAGE_SENDER, READ_DOORS, type MessageState } from '../../shared/operatorMessages.js';
import * as vocab from '../../shared/overlordInbox.js';
import type { InboxAnswer, MessageInboxRow, ProbeRoundRow } from '../../shared/overlordInbox.js';
import type { MessageFacts } from '../src/coord/overlordInbox.js';
import { parseMessageIdCases, readInboxWakeBodyCases, renderInboxWakeLineCases, renderSpotProbeLineCases } from './sim/overlordInboxSets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = INJECTED_PROMPTS['mail-nudge'].text;

describe('the maps and their derived lists', () => {
  it('the bands are written out, in rank order, and bandRank is strictly increasing along them', () => {
    expect(vocab.INBOX_BANDS).toEqual(['probe', 'operator', 'deadline', 'moves', 'background']);
    const ranks = vocab.INBOX_BANDS.map(vocab.bandRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
  });
  it('this build serves the probe band and band 1, and no more', () => {
    expect(vocab.INBOX_SERVED_BANDS).toEqual(['probe', 'operator']);
    for (const b of vocab.INBOX_SERVED_BANDS) expect(vocab.INBOX_BANDS).toContain(b);
  });
  it('the kinds are written out; each has a band of the list and a door the skill names', () => {
    expect(vocab.INBOX_KINDS).toEqual(['probe-round', 'operator-message']);
    expect(Object.keys(vocab.INBOX_KIND_MAP)).toEqual(vocab.INBOX_KINDS);
    const table = readFileSync(path.join(ROOT, 'ccd/overlord-skill/references/starting.md'), 'utf8').split('## The doors')[1]!;
    const named = new Set<string>();
    for (const line of table.split('\n').filter((l) => l.startsWith('| `'))) {
      for (const cell of line.split('|')[1]!.matchAll(/`([^`]+)`/g)) named.add(cell[1]!.split(' ')[0]!);
    }
    for (const kind of vocab.INBOX_KINDS) {
      const row = vocab.INBOX_KIND_MAP[kind];
      expect(vocab.INBOX_BANDS, kind).toContain(row.band);
      expect(named.has(row.door), `${kind}: ${row.door}`).toBe(true);
    }
    expect(vocab.INBOX_KIND_MAP['probe-round']).toEqual({ band: 'probe', door: 'probe' });
    expect(vocab.INBOX_KIND_MAP['operator-message']).toEqual({ band: 'operator', door: 'messages' });
  });
  it('the guards answer the words of their lists and nothing else', () => {
    for (const b of vocab.INBOX_BANDS) expect(vocab.isInboxBand(b)).toBe(true);
    for (const k of vocab.INBOX_KINDS) expect(vocab.isInboxKind(k)).toBe(true);
    for (const n of vocab.ROW_NUDGES) expect(vocab.isRowNudge(n)).toBe(true);
    for (const k of vocab.INBOX_BEHIND_KINDS) expect(vocab.isInboxBehindKind(k)).toBe(true);
    for (const bad of ['', 'toString', 'constructor', 'Probe', 7, null, undefined]) {
      expect([vocab.isInboxBand(bad), vocab.isInboxKind(bad), vocab.isRowNudge(bad), vocab.isInboxBehindKind(bad)], String(bad)).toEqual([false, false, false, false]);
    }
  });
  it('the row nudges and the behind kinds are written out', () => {
    expect(vocab.ROW_NUDGES).toEqual(['message-nudge', 'renewal-feed', 'spot-probe-notice', 'none']);
    expect(vocab.INBOX_BEHIND_KINDS).toEqual(['probe-first', 'page']);
    expect(vocab.MESSAGE_NUDGE).toBe('message-nudge');
  });
  it('PROBE_ROUND_NUDGE is total over the round kinds and answers none for compaction alone', () => {
    expect(Object.keys(vocab.PROBE_ROUND_NUDGE).sort()).toEqual([...PROBE_ROUND_KINDS].sort());
    expect(vocab.PROBE_ROUND_NUDGE).toEqual({ start: 'renewal-feed', spot: 'spot-probe-notice', compaction: 'none' });
    expect(PROBE_ROUND_KINDS.filter((k) => vocab.PROBE_ROUND_NUDGE[k] === 'none')).toEqual(['compaction']);
  });
  it('READ_CEILINGS has a row for exactly READ_DOORS, sequence included, each a positive integer', () => {
    expect([...READ_DOORS].sort()).toEqual(['board', 'history', 'inbox', 'messages', 'sequence']);
    expect(Object.keys(vocab.READ_CEILINGS).sort()).toEqual([...READ_DOORS].sort());
    for (const door of READ_DOORS) {
      const n = vocab.READ_CEILINGS[door].perHour;
      expect(Number.isInteger(n) && n > 0, door).toBe(true);
    }
    expect(Object.fromEntries(READ_DOORS.map((d) => [d, vocab.READ_CEILINGS[d].perHour]))).toEqual({
      inbox: 240, messages: 120, board: 120, history: 60, sequence: 120,
    });
  });
  it('the constants hold their plan values', () => {
    expect(vocab.INBOX_PAGE_ROWS).toBe(100);
    expect(vocab.READ_SERVED_OUTCOME).toBe('rows');
    expect(vocab.READ_CEILING_WINDOW_MS).toBe(3_600_000);
    expect(vocab.INBOX_WAKE_SUBJECT).toBe('inbox-wake');
  });
});

describe('parseMessageId: a path id is a canonical positive safe integer', () => {
  for (const [name, run] of Object.entries(parseMessageIdCases(vocab))) it(name, run);
});

describe('the wake body codec: a header, then one key and value line each, keys and counts only', () => {
  for (const [name, run] of Object.entries(readInboxWakeBodyCases(vocab))) it(name, run);
});

describe('the wake mail', () => {
  const fromOperator = { fromId: OPERATOR_MESSAGE_SENDER, subject: vocab.INBOX_WAKE_SUBJECT };
  it('isInboxWakeMail answers the fixed subject from the operator alone', () => {
    expect(vocab.isInboxWakeMail(fromOperator)).toBe(true);
    for (const fromId of ['coordinator', 'lane-a-project-a', 'operator ', 'Operator', '']) {
      expect(vocab.isInboxWakeMail({ fromId, subject: vocab.INBOX_WAKE_SUBJECT }), fromId).toBe(false);
    }
    for (const subject of ['inbox-wake:1', 'inbox-wake ', 'Inbox-wake', 'inbox', 'operator-message:3', '']) {
      expect(vocab.isInboxWakeMail({ fromId: OPERATOR_MESSAGE_SENDER, subject }), subject).toBe(false);
    }
  });
  it('the sender the L0 file spells is the private store\'s own', () => {
    expect(vocab.INBOX_WAKE_SENDER).toBe(OPERATOR_MESSAGE_SENDER);
  });
});

describe('the lines the mail lane types', () => {
  const lines = (): string[] => [
    vocab.renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 2, firstDue: { kind: 'none' } } }, 0),
    vocab.renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 2, firstDue: { kind: 'by', at: 140_000 } } }, 0),
    vocab.renderInboxWakeLine({ ok: false }, 0),
    vocab.renderSpotProbeLine(),
  ];
  it('every line starts with the mail nudge head, so the echo needle and the injected-prompt census do not change', () => {
    expect(HEAD).toBe('ccrc-mail: you have new mail.');
    for (const l of lines()) expect(l.startsWith(`${HEAD} `), l).toBe(true);
  });
  it('no line names the client or a mail verb: the Overlord has neither', () => {
    for (const l of lines()) {
      const rest = l.slice(HEAD.length);
      expect(l, l).not.toMatch(/ccrc-api/);
      expect(rest, l).not.toMatch(/mail|\bfetch\b|\back\b|\blist\b|curl/i);
      expect(l, l).not.toContain('\n');
    }
  });
  it('the wake line carries the time-left clause only for a deadline', () => {
    const [none, by, refused] = lines();
    expect(none).not.toContain('lapses');
    expect(by).toContain(', the first lapses in 140 s:');
    expect(refused).not.toContain('lapses');
  });
  for (const [name, run] of Object.entries(renderInboxWakeLineCases(vocab))) it(`renderInboxWakeLine: ${name}`, run);
  for (const [name, run] of Object.entries(renderSpotProbeLineCases(vocab))) it(`renderSpotProbeLine: ${name}`, run);
});

describe('the inbox carries ids, never words', () => {
  // A key list the compiler makes exhaustive: a field added to a row or to the answer is a compile error here until it is
  // listed, and the test then holds it is not a field for text.
  const PROBE_ROW_KEYS: Record<keyof ProbeRoundRow, true> = {
    key: true, band: true, at: true, due: true, door: true, kind: true, roundId: true, roundKind: true, questions: true,
  };
  const MESSAGE_ROW_KEYS: Record<keyof MessageInboxRow, true> = {
    key: true, band: true, at: true, due: true, door: true, kind: true, messageId: true, term: true, state: true, cut: true,
  };
  const FACTS_KEYS: Record<keyof MessageFacts, true> = { id: true, at: true, term: true, state: true, cut: true };
  const ANSWER_KEYS: Record<keyof InboxAnswer, true> = { ok: true, at: true, servedBands: true, rows: true, behind: true };
  const FORBIDDEN = ['text', 'question', 'expected', 'words'];
  it('no field of a row, the facts or the answer is named for text', () => {
    for (const keys of [PROBE_ROW_KEYS, MESSAGE_ROW_KEYS, FACTS_KEYS, ANSWER_KEYS]) {
      for (const k of Object.keys(keys)) expect(FORBIDDEN, k).not.toContain(k);
    }
  });
  it('MessageState is the one vocabulary a row\'s state draws on', () => {
    const states: MessageState[] = ['recorded', 'queued', 'delivered', 'picked-up', 'settled', 'spent'];
    expect(states).toHaveLength(6);
  });
});

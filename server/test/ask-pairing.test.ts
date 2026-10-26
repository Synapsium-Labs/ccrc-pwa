// Task Q3g (D-7031; ARCH-58 (#793), server half; plan 2026-10-26-consolidation-w3-questions.md): the envelope-to-dialog
// pairing computed on the server, `pane/askPairing.ts`, held to Q3a's table (`ask-pairing-table.test.ts`, which records
// today's client, `pwa/src/session/askLive.ts`, over the corpus) and to the client row by row. The parity row imports
// the PWA module dynamically by path (the table's precedent) and reads it, never edits it; W7 deletes that row with the
// client copy. The stream rows say which frames the pairing rides: an `ask` frame against the dialog last sent, a
// `dialog` frame against the envelope last sent, and nothing when either is absent or the envelope is an approval.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dialog, HookAskQuestion } from '../../shared/api.js';
import { parseDialog } from '../src/pane/dialog.js';
import {
  askScreen, liveQuestion, namedQuestion, pairEnvelope, questionCorresponds, shownQuestion, titleMatches,
} from '../src/pane/askPairing.js';
import { CORPUS } from './askPairingStream.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PANES = path.join(ROOT, 'server/test/fixtures/panes');

type Row = (typeof CORPUS.rows)[number];
const dialogOf = (row: Row): Dialog | null => {
  if (row.pane === null) return null;
  const d = parseDialog(readFileSync(path.join(PANES, `${row.pane}.txt`), 'utf8'));
  if (d === null) throw new Error(`${row.pane}: parseDialog read no dialog`);
  return { ...d, ...((row.patch ?? {}) as Partial<Dialog>) };
};
const label = (r: Row): string => `${r.pane ?? '(no pane)'} x ${r.envelope}${r.why === undefined ? '' : ` (${r.why})`}`;
const ROWS = CORPUS.rows.map((r) => [label(r), r] as const);

interface AskLive {
  questionCorresponds(q: HookAskQuestion, d: Dialog | null): boolean;
  liveQuestion(a: { questions: HookAskQuestion[] }, d: Dialog | null): number | null;
  namedQuestion(a: { questions: HookAskQuestion[] }, d: Dialog | null): number | null;
  shownQuestion(a: { questions: HookAskQuestion[] }, d: Dialog | null): unknown;
  askScreen(a: { questions: HookAskQuestion[] }, d: Dialog | null): string | null;
  titleMatches(question: string, title: string): boolean;
}
const askLive = async (): Promise<AskLive> => await import(path.join(ROOT, 'pwa/src/session/askLive.ts')) as AskLive;

describe('pane/askPairing.ts: the server\'s envelope pairing (Task Q3g)', () => {
  it.each(ROWS)('the table: %s', (_n, row) => {
    const env = CORPUS.envelopes[row.envelope]!;
    const d = dialogOf(row);
    const e = row.expect;
    expect(pairEnvelope(env, d)).toEqual({
      live: e.live, named: e.named, shown: e.shown.shown, placed: e.shown.placed, screen: e.screen, corresponds: e.corresponds,
    });
    expect(env.questions.map((q) => questionCorresponds(q, d))).toEqual(e.corresponds);
    expect(liveQuestion(env, d)).toBe(e.live);
    expect(namedQuestion(env, d)).toBe(e.named);
    expect(shownQuestion(env, d)).toEqual(e.shown);
    expect(askScreen(env, d)).toBe(e.screen);
  });

  it.each(ROWS)('parity with askLive.ts (W7 deletes this row): %s', async (_n, row) => {
    const L = await askLive();
    const env = CORPUS.envelopes[row.envelope]!;
    const d = dialogOf(row);
    expect(env.questions.map((q) => questionCorresponds(q, d))).toEqual(env.questions.map((q) => L.questionCorresponds(q, d)));
    expect(liveQuestion(env, d)).toBe(L.liveQuestion(env, d));
    expect(namedQuestion(env, d)).toBe(L.namedQuestion(env, d));
    expect(shownQuestion(env, d)).toEqual(L.shownQuestion(env, d));
    expect(askScreen(env, d)).toBe(L.askScreen(env, d));
    if (d !== null) for (const q of env.questions) expect(titleMatches(q.question, d.title)).toBe(L.titleMatches(q.question, d.title));
  });
});

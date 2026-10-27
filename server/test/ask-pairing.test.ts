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
import { SERVER_CAPS, type Dialog, type HookAskQuestion } from '../../shared/api.js';
import { parseDialog } from '../src/pane/dialog.js';
import {
  askScreen, liveQuestion, namedQuestion, pairEnvelope, pairMatches, questionCorresponds, shownQuestion, titleMatches,
} from '../src/pane/askPairing.js';
import { pairMatches as transcriptPairMatches } from '../src/transcript/ask.js';
import { CORPUS, SCENARIOS, runScenario, tablePairing } from './askPairingStream.js';

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

  it('the server keeps one normalize-and-prefix rule: transcript/ask.ts re-exports the one in pane/askPairing.ts', () => {
    expect(transcriptPairMatches).toBe(pairMatches);
    expect(pairMatches('  Yes,  deploy ', 'yes, deploy now')).toBe(true);
    expect(pairMatches('', 'x')).toBe(false);
  });
});

/** Per scenario, per frame sent (`askPairingStream.ts`'s order): the table row its `pairing` equals, or null for none. */
const EXPECTED: Record<string, ([string, string] | null)[]> = {
  'dialog first': [null, null, ['cc300-ask-1q-open', 'COLOUR_ONE']],
  'envelope first': [null, ['cc300-ask-1q-open', 'COLOUR_ONE']],
  'envelope changed under the same dialog': [null, ['cc300-ask-1q-open', 'COLOUR_ONE'], ['cc300-ask-1q-open', 'FRUIT_DRINK']],
  'dialog repainted unparsed': [null, ['cc300-ask-multiselect-next-open', 'COLOUR_FEATURES'],
    ['cc300-ask-multiselect-digit1', 'COLOUR_FEATURES'], ['cc300-ask-multiselect-digit1-3', 'COLOUR_FEATURES']],
  'both cleared': [null, ['cc300-ask-1q-open', 'COLOUR_ONE'], null, null],
  'an approval envelope under a menu': [null, null, ['cc300-ask-1q-open', 'COLOUR_ONE'], null],
};

describe('the session stream sends the pairing on the frames it already sends (Task Q3g)', () => {
  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))('%s', async (_n, sc) => {
    const frames = await runScenario(sc);
    const want = EXPECTED[sc.name]!;
    expect(frames).toHaveLength(want.length);
    frames.forEach(({ frame }, i) => {
      const at = `${sc.name}: frame ${i} (${frame.type})`;
      const w = want[i]!;
      if (w === null) expect('pairing' in frame, at).toBe(false);
      else expect((frame as { pairing?: unknown }).pairing, at).toEqual(tablePairing(w[0], w[1]));
      if (frame.type === 'dialog') expect('pairing' in frame.dialog, `${at}: never inside dialog`).toBe(false);
    });
  }, 30_000);

  // One side cleared while the other is still present, then a frame on the side that is left: the stream must have
  // forgotten the cleared side, so that frame carries no `pairing` (it would otherwise pair against a menu, or an
  // envelope, that is no longer there). `dialog_cleared` resets the dialog side, `ask_cleared` the envelope side.
  it.each([
    ['dialog cleared, then the envelope changes', 'ask', [
      { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
      { pane: null, envelope: 'COLOUR_ONE' },
      { pane: null, envelope: 'FRUIT_DRINK' },
    ]],
    ['envelope cleared, then the dialog repaints', 'dialog', [
      { pane: 'cc300-ask-multiselect-next-open', envelope: 'COLOUR_FEATURES' },
      { pane: 'cc300-ask-multiselect-next-open', envelope: null },
      { pane: 'cc300-ask-multiselect-digit1', envelope: null },
    ]],
  ] as const)('%s: the last %s frame carries no pairing', async (name, type, steps) => {
    const frames = await runScenario({ name, steps: [...steps] });
    const cleared = type === 'ask' ? 'dialog_cleared' : 'ask_cleared';
    const at = frames.findIndex(({ frame }) => frame.type === cleared);
    expect(at, `${name}: a ${cleared} frame is sent`).toBeGreaterThanOrEqual(0);
    const after = frames.slice(at + 1).filter(({ frame }) => frame.type === type);
    expect(after.length, `${name}: a ${type} frame follows the ${cleared}`).toBeGreaterThan(0);
    const last = after[after.length - 1]!.frame;
    expect('pairing' in last, `${name}: the last ${type} frame`).toBe(false);
  }, 30_000);
});

describe('the cap word W7 gates on (Task Q3g)', () => {
  it('SERVER_CAPS advertises ask-pairing-v1', () => {
    expect(SERVER_CAPS).toContain('ask-pairing-v1');
  });
});

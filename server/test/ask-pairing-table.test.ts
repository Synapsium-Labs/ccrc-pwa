// W3's ask-pairing table (slug question-census; Task Q3a, ARCH-58 (#793)'s first commit; plan
// 2026-10-26-consolidation-w3-questions.md). Today the envelope-to-dialog pairing (which of the hook envelope's questions
// the pane is painting) is computed only in the PWA, by `pwa/src/session/askLive.ts`. Q3g ports it to the server
// (`pane/askPairing.ts`) and holds the port equal to this table; W7 then deletes the PWA's copy. So the table is TODAY'S
// CLIENT ANSWERS, recorded: green on `main` by construction, and the expectation both later halves are held to.
//
// The corpus (`fixtures/ask-pairing/corpus.json`): every recorded Claude Code 2.1.300 ask screen
// (`fixtures/panes/cc300-ask-*.txt`), read through the server's `parseDialog` at test time (never a stored reading),
// against every recorded envelope (`pwa/test/askPanes.ts`'s, copied in as data), plus synthetic rows, each saying why:
// a Yes/No tie only the title breaks, a wrapped title under `│ `, a multiSelect question against boxes and against a
// parsed menu, an unparsed grab, a question with no options, the review screen and no pane. A synthetic screen is a
// recorded one with a `patch` over its reading. A row's `expect` is never regenerated to make a change pass: a change to
// the pairing is a behaviour change, and its PR says so.
//
// The PWA module is imported dynamically by path (`collect-attention.test.ts`'s precedent): the server does not depend
// on the PWA at build time, and this test reads it, never edits it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dialog, HookAskQuestion } from '../../shared/api.js';
import { parseDialog } from '../src/pane/dialog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PANES = path.join(ROOT, 'server/test/fixtures/panes');

interface Envelope { questions: HookAskQuestion[] }
interface Expect {
  corresponds: boolean[];
  live: number | null;
  named: number | null;
  shown: { live: number | null; named: number | null; shown: number; placed: number | null };
  screen: string | null;
}
interface Row { why?: string; envelope: string; pane: string | null; patch?: Partial<Dialog>; expect: Expect }
const CORPUS = JSON.parse(readFileSync(path.join(ROOT, 'server/test/fixtures/ask-pairing/corpus.json'), 'utf8')) as {
  envelopes: Record<string, Envelope>; rows: Row[];
};

interface AskLive {
  questionCorresponds(q: HookAskQuestion, d: Dialog | null): boolean;
  liveQuestion(a: Envelope, d: Dialog | null): number | null;
  namedQuestion(a: Envelope, d: Dialog | null): number | null;
  shownQuestion(a: Envelope, d: Dialog | null): Expect['shown'];
  askScreen(a: Envelope, d: Dialog | null): string | null;
}
const askLive = async (): Promise<AskLive> => await import(path.join(ROOT, 'pwa/src/session/askLive.ts')) as AskLive;

/** The row's screen: the recorded pane through `parseDialog`, with the row's patch over it; `null` for no pane. */
const dialogOf = (row: Row): Dialog | null => {
  if (row.pane === null) return null;
  const d = parseDialog(readFileSync(path.join(PANES, `${row.pane}.txt`), 'utf8'));
  if (d === null) throw new Error(`${row.pane}: parseDialog read no dialog`);
  return { ...d, ...(row.patch ?? {}) };
};
const label = (r: Row): string => `${r.pane ?? '(no pane)'} x ${r.envelope}${r.why === undefined ? '' : ` (${r.why})`}`;

describe('the ask-pairing table: askLive.ts over the corpus (slug question-census)', () => {
  it('the corpus is whole: every row names an envelope and a recorded pane, and the synthetic rows are present', () => {
    expect(CORPUS.rows.length).toBeGreaterThan(0);
    for (const r of CORPUS.rows) {
      expect(CORPUS.envelopes[r.envelope], label(r)).toBeDefined();
      expect(r.expect.corresponds, label(r)).toHaveLength(CORPUS.envelopes[r.envelope]!.questions.length);
    }
    const whys = CORPUS.rows.flatMap((r) => (r.why === undefined ? [] : [r.why]));
    for (const w of ['a Yes/No tie the title breaks: question 2', 'a wrapped title under the bar breaks a label tie',
      'a multiSelect question against its boxes', 'a multiSelect question against a parsed menu never corresponds',
      'an unparsed grab never corresponds', 'a question with no options is never a candidate', 'the review screen']) {
      expect(whys, w).toContain(w);
    }
  });

  it.each(CORPUS.rows.map((r) => [label(r), r] as const))('%s', async (_name, row) => {
    const L = await askLive();
    const env = CORPUS.envelopes[row.envelope]!;
    const d = dialogOf(row);
    expect({
      corresponds: env.questions.map((q) => L.questionCorresponds(q, d)),
      live: L.liveQuestion(env, d),
      named: L.namedQuestion(env, d),
      shown: L.shownQuestion(env, d),
      screen: L.askScreen(env, d),
    }).toEqual(row.expect);
  });
});

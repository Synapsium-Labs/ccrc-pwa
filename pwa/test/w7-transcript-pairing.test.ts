// The transcript-copy path, pinned before C7f (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 6; ARCH-58, D-7206). The wire pairs only the hook's
// envelope; when there is no usable envelope (it aged out, or is blank), `askLive.ts#askSource`'s rule 6 answers
// `{kind: 'structured', from: 'transcript'}` from the transcript's copy of the question (`Dialog.ask`), and
// `DialogSheet` pairs that copy on the client (`shownQuestion({questions: source.questions}, dialog)`). Deleting the
// client functions before C7q's pairing reaches the wire would drop every such question to the raw dialog.
//
// THE CORPUS is the PWA's recorded asks (`askPanes.ts`): every single-select question of every recorded envelope, as
// the transcript's copy on every recorded parsed screen, with no hook envelope (the stream said `ask_cleared`); and
// `askFixtures.ts`' rows. For every row where `askSource` answers `structured` `from: 'transcript'`, the pin is the
// sheet's pairing (`live`, `named`, `placed`; `shown` is always 0, the copy is one question), whether the sheet renders
// the copy's question, and the option index a tap on its first row sends (`api.answerDialog`), rendered through
// `DialogSheet` itself.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Dialog, HookAskQuestion } from '../../shared/api';
import { askSource, shownQuestion } from '../src/session/askLive';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import { api } from '../src/lib/api';
import {
  CACHING_TRACING, CC296_LONG, COLOUR_FEATURES, COLOUR_ONE, DRINK_FEATURES_TOOLS, FOUR_Q, FRUIT_DRINK, PETS_SIZE_MODE, pane, type AskEnvelope,
} from './askPanes';
import { askFixture } from './askFixtures';
import panes from './ask-panes.json';

const SESSION_ID = 'lane-a:project-a';
const ENVELOPES: Record<string, AskEnvelope> = { COLOUR_ONE, FRUIT_DRINK, CACHING_TRACING, FOUR_Q, COLOUR_FEATURES, DRINK_FEATURES_TOOLS, PETS_SIZE_MODE, CC296_LONG };
const PARSED: readonly string[] = Object.entries(panes as Record<string, { parsed: boolean }>).filter(([, v]) => v.parsed).map(([k]) => k);

/** The transcript's copy of one question on a recorded screen, every row aligned (`dialog-sheet.test.tsx`'s rule: the
 *  server attaches `Dialog.ask` only to a parsed pane). */
const transcribed = (dialog: Dialog, q: HookAskQuestion): Dialog => ({
  ...dialog,
  ask: { question: q.question, ...(q.header === undefined ? {} : { header: q.header }), multiSelect: q.multiSelect === true, options: q.options.map((o) => ({ ...o })) },
});

interface Row { readonly name: string; readonly dialog: Dialog }
function corpus(): Row[] {
  const out: Row[] = [];
  for (const [env, e] of Object.entries(ENVELOPES)) {
    e.questions.forEach((q, i) => {
      if (q.multiSelect === true) return;
      for (const p of PARSED) out.push({ name: `${env}.q${i + 1} on ${p}`, dialog: transcribed(pane(p), q) });
    });
  }
  for (let n = 0; n <= 11; n++) {
    const f = askFixture(n);
    if (f.ask === null && f.dialog !== null && f.askFrameSeen) out.push({ name: `askFixture(${n})`, dialog: f.dialog });
  }
  return out;
}

const fakeSocket = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** Render the sheet over `dialog` with no hook envelope, and tap the copy's first row. */
function sheet(dialog: Dialog): { question: boolean; tap: number | 'none' } {
  const store = createSessionStore(SESSION_ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
  act(() => { store.getState().apply({ type: 'ask_cleared' }); store.getState().apply({ type: 'dialog', dialog }); });
  const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
  render(createElement(DialogSheet, { id: SESSION_ID, store }));
  // The copy's first line, as written or with its Markdown marks rendered away (the sheet may render either).
  const line = dialog.ask!.question.split('\n')[0]!;
  const text = document.body.textContent ?? '';
  const question = text.includes(line.slice(0, 30)) || text.includes(line.replace(/[*`]/g, '').slice(0, 30));
  const first = document.querySelector<HTMLElement>('.opts > .opt');
  if (first !== null && !(first as HTMLButtonElement).disabled) fireEvent.click(first);
  const tap = answer.mock.calls.length === 0 ? 'none' : (answer.mock.calls[0]![2] as number);
  cleanup();
  answer.mockRestore();
  return { question, tap };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the transcript-copy rows (askSource answers structured from the transcript)', () => {
  it('every such row: its pairing, its question on the sheet, and the index a tap sends', () => {
    const rows: string[] = [];
    let others = 0;
    for (const r of corpus()) {
      const src = askSource({ ask: null, dialog: r.dialog, askFrameSeen: true });
      if (src.kind !== 'structured' || src.from !== 'transcript') { others += 1; continue; }
      const p = shownQuestion({ questions: src.questions }, r.dialog);
      const s = sheet(r.dialog);
      rows.push(`${r.name}: live ${String(p.live)} named ${String(p.named)} placed ${String(p.placed)} shown ${p.shown} | question ${s.question ? 'shown' : 'absent'} | tap ${String(s.tap)}`);
    }
    console.log(`w7-transcript-pairing: ${rows.length} transcript rows, ${others} rows answered otherwise\n${rows.map((x) => `  ${x}`).join('\n')}`);
    // The copy is placed (a tap sends its row's index) on these rows, each pinned whole; on every other transcript row
    // it is shown read-only, unplaced, and a tap sends nothing.
    const UNPLACED = 'live null named null placed null shown 0 | question shown | tap none';
    expect(rows.filter((x) => !x.endsWith(UNPLACED))).toEqual(PLACED);
    expect(rows.filter((x) => x.endsWith(UNPLACED)).length).toBe(317);
    expect(rows.length).toBe(346);
  });
});

const PLACED: readonly string[] = [
  'COLOUR_ONE.q1 on cc300-ask-1q-open: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'FRUIT_DRINK.q1 on cc300-ask-freetext-held: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'FRUIT_DRINK.q2 on cc300-ask-q2-of-2-single: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-same-labels-q1: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-same-labels-q2: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-freetext-walk-2-focused: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-freetext-walk-3-typed: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-freetext-walk-4-stepped-off: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q1 on cc300-ask-freetext-walk-5-back-on-held: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-same-labels-q1: live 0 named null placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-same-labels-q2: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-freetext-walk-2-focused: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-freetext-walk-3-typed: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-freetext-walk-4-stepped-off: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CACHING_TRACING.q2 on cc300-ask-freetext-walk-5-back-on-held: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'FOUR_Q.q1 on cc300-ask-markdown-question: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'FOUR_Q.q2 on cc300-ask-wrapped-question: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'FOUR_Q.q2 on cc300-ask-freetext-1000: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'COLOUR_FEATURES.q1 on cc300-ask-q1-of-2: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'DRINK_FEATURES_TOOLS.q1 on cc300-ask-q2-of-2-single: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q1 on cc296-ask-2q-long-q1: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q1 on cc296-ask-2q-long-q1-on-text: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q1 on cc296-ask-2q-long-q1-typed: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q1 on cc296-ask-2q-long-q1-on-chat: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q1 on cc296-ask-2q-long-revisit-q1: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q2 on cc296-ask-2q-long-q2: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q2 on cc296-ask-2q-long-right-q2: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'CC296_LONG.q2 on cc296-ask-2q-long-revisit-q2: live 0 named 0 placed 0 shown 0 | question shown | tap 1',
  'askFixture(2): live 0 named null placed 0 shown 0 | question shown | tap 1',
];

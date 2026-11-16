// The wire's `pairing` for the PWA's tests (W7 Task C7f, D-7184, D-7363; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7f). Since C7f the sheets read the frames' `pairing`
// and compute none of their own, so a test that stands for a server carrying C7q hands its frames the pairing that server
// sends. Where a recorded table holds the state, the pairing is read from it: Q3a's `corpus.json` (`tablePairing`, the
// same lookup as `server/test/askPairingStream.ts#tablePairing`) and C7q's `transcript-corpus.json` (`recordedPairing`).
// Everywhere else (a DERIVED dialog, a screen or an envelope the server's corpus does not hold) it is the server's own
// rule, `server/src/pane/askPairing.ts#framePairing` (D-7363): a test-only import of the one pure module the stream
// pairs with, never a second copy of the rule. `served` attaches it frame by frame as `server/src/sessionws.ts#paired`
// does: an `ask` frame against the dialog last sent, a `dialog` frame against the envelope last sent, an `ask_cleared`
// frame against the dialog last sent with no envelope (D-7211), and `dialog_cleared` none.
//
// The PWA's own code never imports this: the sheets read the wire.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AskPairing, Dialog, HookAsk, SessionStreamMsg } from '../../shared/api';
// `.github/ci/reach.mjs#READS` lists `server/src/pane/`, so a change to the server's pairing runs these suites.
import { framePairing } from '../../server/src/pane/askPairing';
import type { SessionStore } from '../src/stores/session';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'ask-pairing');

interface CorpusRow {
  why?: string;
  envelope: string;
  pane: string | null;
  patch?: unknown;
  expect: {
    corresponds: boolean[]; live: number | null; named: number | null;
    shown: { live: number | null; named: number | null; shown: number; placed: number | null }; screen: string | null;
  };
}
const CORPUS = JSON.parse(readFileSync(path.join(FIXTURES, 'corpus.json'), 'utf8')) as { rows: CorpusRow[] };
const TRANSCRIPT = JSON.parse(readFileSync(path.join(FIXTURES, 'transcript-corpus.json'), 'utf8')) as {
  rows: { name: string; source: string; pairing: AskPairing | null }[];
};
const BY_NAME = new Map(TRANSCRIPT.rows.map((r) => [r.name, r]));

/** Q3a's recorded row for a recorded pane under a corpus envelope, as the wire's flat `pairing` shape. */
export function tablePairing(pane: string, envelope: string): AskPairing {
  const row = CORPUS.rows.find((r) => r.pane === pane && r.envelope === envelope && r.why === undefined && r.patch === undefined);
  if (row === undefined) throw new Error(`corpus.json has no row ${pane} x ${envelope}`);
  const e = row.expect;
  return { live: e.live, named: e.named, shown: e.shown.shown, placed: e.shown.placed, screen: e.screen, corresponds: e.corresponds };
}

/** C7q's recorded pairing for a state of its corpus, by the row's name; `undefined` when the table holds no such row. */
export function recordedPairing(name: string): AskPairing | null | undefined {
  return BY_NAME.get(name)?.pairing;
}

/** The pairing the server attaches for this envelope and this dialog (`framePairing`), or null for none. */
export function wirePairing(ask: HookAsk | null, dialog: Dialog | null): AskPairing | null {
  return framePairing(ask, dialog);
}

/** One stream's attach rule (`sessionws.ts#paired`): a function from each frame sent to the frame with its pairing, over
 *  the envelope and the dialog this stream has sent. A frame that already carries a pairing is kept as it is. */
export function pairer(): (m: SessionStreamMsg) => SessionStreamMsg {
  let sentAsk: HookAsk | null = null;
  let sentDialog: Dialog | null = null;
  return (m) => {
    if (m.type === 'dialog') sentDialog = m.dialog;
    else if (m.type === 'dialog_cleared') sentDialog = null;
    else if (m.type === 'ask') sentAsk = m.ask;
    else if (m.type === 'ask_cleared') sentAsk = null;
    else return m;
    if (m.type === 'dialog_cleared' || 'pairing' in m) return m;
    const pairing = framePairing(sentAsk, sentDialog);
    return pairing === null ? m : { ...m, pairing };
  };
}

/** The frames a server carrying C7q sends for these, in order (`pairer`). */
export const pairedFrames = (frames: readonly SessionStreamMsg[]): SessionStreamMsg[] => frames.map(pairer());

/** `store`, served by a server carrying C7q: every frame handed to its `apply` (a test's, or its socket's) gains the
 *  pairing that server attaches (`pairer`, over one stream's sent state). Returns the store.
 *
 *  `frameFirst`: an answer route's reply also comes in the server's order (D-7220, C7q's recorded sequence (e)): the
 *  route emits `answered:<id>` before it replies, so the stream's frame for `next` (`sessionws.ts#onAnswered`: a `dialog`
 *  frame, or `dialog_cleared` for no menu, none for the screen it last sent) reaches the store before `applyAnswered`
 *  does. For a suite whose rows answer and read the next screen from the reply alone, as a server carrying C7q never
 *  leaves them for longer than the two connections' skew. Without it the reply is the store's own, reply-first, as
 *  `session-store-pairing.test.ts`'s D-7220 rows replay it. */
export function served<S extends SessionStore>(store: S, o: { frameFirst?: boolean } = {}): S {
  const { apply, applyAnswered } = store.getState();
  const pair = pairer();
  let sent: Dialog | null = null;
  const send = (m: SessionStreamMsg): void => {
    if (m.type === 'dialog') sent = m.dialog;
    else if (m.type === 'dialog_cleared') sent = null;
    apply(pair(m));
  };
  store.setState(o.frameFirst !== true ? { apply: send } : {
    apply: send,
    applyAnswered: (answeredId: string, next: Dialog | null) => {
      if (next === null ? sent !== null : next.id !== sent?.id) send(next === null ? { type: 'dialog_cleared' } : { type: 'dialog', dialog: next });
      applyAnswered(answeredId, next);
    },
  });
  return store;
}

/** A routed session socket (`playwright-core`'s `WebSocketRoute`, the browser leg's), served by a server carrying C7q:
 *  every JSON frame its `send` is handed gains the pairing that server attaches (`pairer`, one per socket, as one stream
 *  is per connection). The socket itself is changed and returned, so every reference a test keeps to it sends paired. */
export function servedSocket<T extends { send(message: string | Buffer): void }>(ws: T): T {
  const pair = pairer();
  const send = ws.send.bind(ws);
  ws.send = (m: string | Buffer): void => send(typeof m === 'string' ? JSON.stringify(pair(JSON.parse(m) as SessionStreamMsg)) : m);
  return ws;
}

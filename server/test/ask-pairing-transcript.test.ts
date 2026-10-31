// Task C7q's parity row (D-7206, D-7211, D-7212, D-7213; ARCH-58 (#793), a prerequisite of C7f; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7q). Q3g's pattern (`ask-pairing.test.ts`): the
// server's `pairing`, as `server/src/sessionws.ts#paired` attaches it, held to today's client,
// `pwa/src/session/askLive.ts`, imported dynamically by path and never edited.
//
// THE CORPUS is Q3a's (`fixtures/ask-pairing/corpus.json`: every recorded 2.1.300 ask screen through `parseDialog`,
// against every recorded envelope, plus its synthetic rows), extended with the transcript-copy states: every question of
// every corpus envelope as the transcript's copy (`Dialog.ask`, every row aligned) on every parsed corpus screen with no
// hook envelope; and, for each envelope's first question with options on every such screen, the same under a blank
// question envelope, the same with its last row not aligned (a partly aligned copy) and the same under an approval
// envelope; a blank envelope over every parsed screen with no copy (the state where the server's
// `'questions' in ask` and the client's `isUsableAsk` disagreed); and the HOOK+COPY states, the most common live one:
// every usable corpus envelope (`usableQuestions`) over every parsed corpus screen whose `Dialog.ask` is the copy of
// one of that envelope's questions, where both sides pair the hook's envelope (`from` absent, read as `'hook'`).
//
// THE RULE (D-7213): a pairing is present exactly when the server has a dialog and a question source: the hook's usable
// question envelope (on any dialog, the review screen included), else the transcript's copy (D-7206); an approval pairs
// nothing. `from` is compared only where `askSource` answers `structured` and a dialog exists, and there it equals
// `askSource`'s (`'hook'` when the field is absent). `live`, `named`, `shown`, `placed`, `screen` and `corresponds`
// equal `shownQuestion`, `askScreen` and `questionCorresponds` over the paired questions. Two classes are named: the
// REVIEW rows (a hook pairing with `screen: 'review'` while `askSource` answers `review`, which has no `from`) and the
// NO-PANE rows (a question envelope, `dialog` null: no pairing while `askSource` answers `structured` `from: 'hook'`).
//
// Each state is paired the way the stream pairs it: `paired` itself, over the `dialog` frame (against the envelope last
// sent) and over the envelope's own frame (`ask`, or `ask_cleared` when there is none, against the dialog last sent).
// The table it compares is recorded as `fixtures/ask-pairing/transcript-corpus.json`, so C7f can re-point to it.
//
// ONE ROW IS PERMANENT (D-7212): "the server's `from` equals `askSource`'s" keeps importing `askLive.ts#askSource` by
// path after C7f, because `askSource` survives C7f and nothing else holds the two sides' choice of source equal.
//
// W7 Task C7f (D-7184) deleted the client's pairing functions, so every other row reads the recorded table
// (`transcript-corpus.json`: today's client, recorded by C7q, its `source` and its `pairing` per state) where it once
// imported `askLive.ts`. The table's rows are fixed: a pairing change is a behaviour change, and its PR says so.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskPairing, Dialog, DialogAsk, HookAsk, HookAskQuestion, SessionStreamMsg } from '../../shared/api.js';
import { usableQuestions } from '../../shared/ask-menu.js';
import { parseDialog } from '../src/pane/dialog.js';
import { SessionStream } from '../src/sessionws.js';
import { BLANK, CORPUS, TRANSCRIPT_SEQUENCES, envelopeOf, runSequence, type Sent } from './askPairingStream.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PANES = path.join(ROOT, 'server/test/fixtures/panes');
const TABLE = path.join(ROOT, 'server/test/fixtures/ask-pairing/transcript-corpus.json');
const SEQUENCES = path.join(ROOT, 'server/test/fixtures/ask-pairing/transcript-sequences.json');
/** Set to `1` to rewrite the recorded sequences from this run (a reviewed change only; a row's expectation is never
 *  regenerated to make a server change pass). The corpus table was recorded from the client before C7f deleted it, and
 *  is not re-recorded: the server is held to it. */
const RECORD = process.env.C7Q_RECORD === '1';

type WirePairing = AskPairing & { readonly from?: 'hook' | 'transcript' };
type Source = { kind: 'structured'; questions: readonly HookAskQuestion[]; from: 'hook' | 'transcript' } | { kind: string };
/** What the PERMANENT row reads of the client (D-7212): its choice of source, which survives C7f. */
interface AskLive {
  askSource(i: { ask: HookAsk | null; dialog: Dialog | null; askFrameSeen: boolean }): Source;
  isUsableAsk(a: HookAsk | null): boolean;
}
const askLive = async (): Promise<AskLive> => await import(path.join(ROOT, 'pwa/src/session/askLive.ts')) as AskLive;

// ─── the corpus ────────────────────────────────────────────────────────────────────────────────────────────────────

type Cls = 'hook' | 'hook+copy' | 'transcript' | 'blank-envelope' | 'blank-envelope-no-copy' | 'partly-aligned' | 'approval';
interface State { readonly name: string; readonly cls: Cls; readonly ask: HookAsk | null; readonly dialog: Dialog | null }

const APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'git push origin main' } };
const read = (pane: string): Dialog => {
  const d = parseDialog(readFileSync(path.join(PANES, `${pane}.txt`), 'utf8'));
  if (d === null) throw new Error(`${pane}: parseDialog read no dialog`);
  return d;
};
/** The transcript's copy of `q` as `alignAsk` hands it on, every row aligned, or with its last row `null`. */
const copyOf = (q: HookAskQuestion, partial = false): DialogAsk => ({
  question: q.question, multiSelect: q.multiSelect === true,
  options: q.options.map((o, i) => (partial && i === q.options.length - 1 ? null : { label: o.label })),
});

function corpus(): State[] {
  const out: State[] = [];
  for (const r of CORPUS.rows) {
    const dialog = r.pane === null ? null : { ...read(r.pane), ...((r.patch ?? {}) as Partial<Dialog>) };
    out.push({ name: `${r.pane ?? '(no pane)'} x ${r.envelope}${r.why === undefined ? '' : ` (${r.why})`}`, cls: 'hook', ask: envelopeOf(r.envelope), dialog });
  }
  const panes = [...new Set(CORPUS.rows.flatMap((r) => (r.pane === null ? [] : [r.pane])))].sort().filter((p) => read(p).parsed);
  for (const p of panes) {
    out.push({ name: `${p} under a blank envelope, no copy`, cls: 'blank-envelope-no-copy', ask: BLANK, dialog: read(p) });
    for (const [env, e] of Object.entries(CORPUS.envelopes)) {
      e.questions.forEach((q, i) => {
        if (q.options.length === 0) return;
        const at = `${env}.q${i + 1} on ${p}`;
        const dialog = { ...read(p), ask: copyOf(q) };
        out.push({ name: `${at}, no envelope`, cls: 'transcript', ask: null, dialog });
        // The hook's usable envelope over its own question's copy: the hook's pairing on both sides, never the copy's.
        if (usableQuestions(e)) out.push({ name: `${at}, under ${env}`, cls: 'hook+copy', ask: envelopeOf(env), dialog });
        // The contrast states, over each envelope's first question with options (the table stays reviewable).
        if (e.questions.findIndex((x) => x.options.length > 0) !== i) return;
        out.push({ name: `${at}, a blank envelope`, cls: 'blank-envelope', ask: BLANK, dialog });
        out.push({ name: `${at}, an approval`, cls: 'approval', ask: APPROVAL, dialog });
        out.push({ name: `${at}, partly aligned`, cls: 'partly-aligned', ask: null, dialog: { ...read(p), ask: copyOf(q, true) } });
      });
    }
  }
  return out;
}

// ─── the two sides ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The stream's own attach rule: `SessionStream#paired` with the envelope and the dialog it last sent. */
const paired = (SessionStream.prototype as unknown as {
  paired(this: { sentAsk: HookAsk | null; sentDialog: Dialog | null }, m: SessionStreamMsg): SessionStreamMsg;
}).paired;
const pairingOf = (f: SessionStreamMsg): WirePairing | null => (f as { pairing?: WirePairing }).pairing ?? null;

/** The server's pairing for a state, on the `dialog` frame and on the envelope's own frame; they must agree. */
function serverPairing(s: State): { dialog: WirePairing | null; envelope: WirePairing | null } {
  const env: SessionStreamMsg = s.ask === null ? { type: 'ask_cleared' } : { type: 'ask', ask: s.ask, key: null };
  return {
    dialog: s.dialog === null ? null : pairingOf(paired.call({ sentAsk: s.ask, sentDialog: null }, { type: 'dialog', dialog: s.dialog })),
    envelope: pairingOf(paired.call({ sentAsk: null, sentDialog: s.dialog }, env)),
  };
}

/** A state's recorded row (`transcript-corpus.json`): the client's `source` and `pairing`, by the rule of D-7213, as
 *  C7q recorded them before C7f. */
interface Recorded { name: string; source: string; pairing: WirePairing | null }
const RECORDED = (JSON.parse(readFileSync(TABLE, 'utf8')) as { rows: Recorded[] }).rows;
const BY_NAME = new Map(RECORDED.map((r) => [r.name, r]));
const recordedOf = (name: string): Recorded => {
  const r = BY_NAME.get(name);
  if (r === undefined) throw new Error(`transcript-corpus.json has no row ${name}`);
  return r;
};
/** `from` is compared only where the client answered `structured` and a dialog exists (D-7213). */
const comparesFrom = (r: Recorded, dialog: Dialog | null): boolean => r.source.startsWith('structured:') && dialog !== null;

const withoutFrom = (p: WirePairing | null): WirePairing | null => {
  if (p === null) return null;
  const { from: _f, ...rest } = p;
  return rest;
};

const STATES = corpus();
const ROWS = STATES.map((s) => [`${s.cls}: ${s.name}`, s] as const);

describe('the transcript copy\'s pairing on the wire equals the client\'s (Task C7q, D-7206, D-7213)', () => {
  it('the corpus holds every class, and the transcript states are the ones askSource answers structured from the transcript', () => {
    const count = (c: Cls): number => STATES.filter((s) => s.cls === c).length;
    for (const c of ['hook', 'hook+copy', 'transcript', 'blank-envelope', 'blank-envelope-no-copy', 'partly-aligned', 'approval'] as const) expect(count(c), c).toBeGreaterThan(0);
    const fromTranscript = STATES.filter((s) => recordedOf(`${s.cls}: ${s.name}`).source === 'structured:transcript');
    expect(fromTranscript.length).toBeGreaterThan(0);
    expect(new Set(fromTranscript.map((s) => s.cls))).toEqual(new Set(['transcript', 'blank-envelope']));
  });

  it('the hook+copy states: a usable envelope over a dialog carrying the copy of one of its questions is the hook\'s, on both sides', () => {
    const states = STATES.filter((s) => s.cls === 'hook+copy');
    const structured = states.filter((s) => recordedOf(`${s.cls}: ${s.name}`).source === 'structured:hook');
    expect(structured.length, 'hook+copy states askSource answers structured from the hook').toBeGreaterThan(0);
    for (const s of states) {
      expect(s.dialog?.ask, s.name).toBeDefined();
      expect(['structured:hook', 'review'], s.name).toContain(recordedOf(`${s.cls}: ${s.name}`).source);
      const got = serverPairing(s).dialog;
      expect(got, s.name).not.toBeNull();
      expect(got!.from ?? 'hook', s.name).toBe('hook');
    }
  });

  it.each(ROWS)('%s', (n, s) => {
    const want = recordedOf(n);
    const got = serverPairing(s);
    expect(got.envelope, 'the envelope\'s frame and the dialog frame carry one pairing').toEqual(got.dialog);
    if (comparesFrom(want, s.dialog)) expect(got.dialog).toEqual(want.pairing);
    else expect(withoutFrom(got.dialog)).toEqual(withoutFrom(want.pairing));
  });

  it('the recorded table (transcript-corpus.json) is this corpus, row for row and in order', () => {
    expect(RECORDED.map((r) => r.name)).toEqual(STATES.map((s) => `${s.cls}: ${s.name}`));
  });
});

describe('the named row classes (D-7213): green on the base and after', () => {
  it('the review rows: a hook pairing with screen review while askSource answers review', () => {
    const review = STATES.filter((s) => s.cls === 'hook' && s.dialog !== null && recordedOf(`${s.cls}: ${s.name}`).source === 'review');
    expect(review.map((s) => s.name)).toContain('cc300-ask-review-same-labels x CACHING_TRACING');
    for (const s of review) expect(serverPairing(s).dialog?.screen, s.name).toBe('review');
  });

  it('the no-pane rows: a question envelope with no dialog carries no pairing while askSource answers structured from the hook', () => {
    const none = STATES.filter((s) => s.cls === 'hook' && s.dialog === null);
    expect(none.length).toBeGreaterThan(0);
    for (const s of none) {
      expect(serverPairing(s).envelope, s.name).toBeNull();
      expect(recordedOf(`${s.cls}: ${s.name}`).source, s.name).toBe('structured:hook');
    }
  });
});

// PERMANENT (D-7212): this row stays importing `askLive.ts#askSource` by path after C7f re-points the rest to the
// recorded tables. It is the one comparison of the two sides' choice of source.
describe('PERMANENT: the server\'s from equals askSource\'s (D-7212, D-7213)', () => {
  it('over the rows where askSource answers structured and a dialog exists, the pairing is present and its from is askSource\'s; on the review and no-pane rows it is as named', async () => {
    const L = await askLive();
    let compared = 0;
    for (const s of STATES) {
      const src = L.askSource({ ask: s.ask, dialog: s.dialog, askFrameSeen: true });
      const got = s.dialog === null ? serverPairing(s).envelope : serverPairing(s).dialog;
      if (src.kind === 'structured' && s.dialog !== null) {
        compared += 1;
        expect(got, s.name).not.toBeNull();
        expect(got!.from ?? 'hook', s.name).toBe((src as Extract<Source, { kind: 'structured' }>).from);
      } else if (src.kind === 'structured') {
        expect(got, `${s.name}: a no-pane row`).toBeNull();
      } else if (src.kind === 'review' && s.ask !== null && 'questions' in s.ask && L.isUsableAsk(s.ask)) {
        expect(got?.screen, `${s.name}: a review row`).toBe('review');
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});

// ─── the frame sequences (D-7211, D-7220) ─────────────────────────────────────────────────────────────────────────

/** The end state a sequence leaves the client in: the last envelope and the last dialog the stream sent. */
function endState(frames: readonly Sent[]): { ask: HookAsk | null; dialog: Dialog | null } {
  let ask: HookAsk | null = null;
  let dialog: Dialog | null = null;
  for (const { frame } of frames) {
    if (frame.type === 'ask') ask = frame.ask;
    else if (frame.type === 'ask_cleared') ask = null;
    else if (frame.type === 'dialog') dialog = frame.dialog;
    else if (frame.type === 'dialog_cleared') dialog = null;
  }
  return { ask, dialog };
}

/** Each sequence's end state as a recorded corpus row (C7f, D-7184: the recorded client answer for it), or null where the
 *  end state has no dialog, which pairs nothing (D-7213). Sequence (d)'s menu carries no copy at all (under four options
 *  `alignAsk` forgives no row), and the partly aligned row is its recorded state: no source, so no pairing, either way. */
const END_ROW: Record<string, string | null> = {
  '(a) connect with a copy and no envelope': 'transcript: COLOUR_ONE.q1 on cc300-ask-1q-open, no envelope',
  '(b) an envelope ageing out under a standing menu': 'transcript: COLOUR_ONE.q1 on cc300-ask-1q-open, no envelope',
  '(c) a reconnect mid-ask, with an envelope': 'hook+copy: COLOUR_ONE.q1 on cc300-ask-1q-open, under COLOUR_ONE',
  '(c) a reconnect mid-ask, without an envelope': 'transcript: COLOUR_ONE.q1 on cc300-ask-1q-open, no envelope',
  '(a) connect with a blank envelope and a copy': 'blank-envelope: COLOUR_ONE.q1 on cc300-ask-1q-open, a blank envelope',
  '(d) a menu with no readable copy, then the envelope clearing': 'partly-aligned: COLOUR_ONE.q1 on cc300-ask-1q-open, partly aligned',
  '(e) an answer that moves the pane to the next question': 'hook: cc300-ask-q2-of-2-single x FRUIT_DRINK',
  '(e) an answer whose next is no menu': null,
  '(e) a dialog_cleared before the answer settles': 'hook: cc300-ask-q2-of-2-single x FRUIT_DRINK',
};

describe('the transcript copy\'s frame sequences, on a real SessionStream (D-7211, D-7220)', () => {
  it.each(TRANSCRIPT_SEQUENCES.map((sc) => [sc.name, sc] as const))('%s: the last frame of the pair carries the recorded client pairing for the end state', async (_n, sc) => {
    const { frames } = await runSequence(sc);
    const last = frames.at(-1)!.frame;
    const { dialog } = endState(frames);
    const row = END_ROW[sc.name];
    expect(row, `${sc.name}: an end row is named`).not.toBeUndefined();
    expect(dialog === null, `${sc.name}: the end state has no dialog exactly where no row is named`).toBe(row === null);
    const want = row === null || row === undefined ? null : recordedOf(row);
    const got = last.type === 'dialog_cleared' ? null : pairingOf(last);
    if (want !== null && comparesFrom(want, dialog)) expect(got, `${sc.name}: ${last.type}`).toEqual(want.pairing);
    else expect(withoutFrom(got), `${sc.name}: ${last.type}`).toEqual(withoutFrom(want?.pairing ?? null));
  }, 30_000);
});

describe('the recorded frame sequences (transcript-sequences.json, D-7211): what C7f\'s store rows replay', () => {
  it('every sequence\'s frames as sent, pairing on, and the answer routes\' reply bodies beside them', async () => {
    const out: Record<string, Awaited<ReturnType<typeof runSequence>>> = {};
    for (const sc of TRANSCRIPT_SEQUENCES) out[sc.name] = await runSequence(sc);
    if (RECORD) writeFileSync(SEQUENCES, `${JSON.stringify(out, null, 1)}\n`);
    const recorded = JSON.parse(readFileSync(SEQUENCES, 'utf8')) as typeof out;
    expect(recorded).toEqual(JSON.parse(JSON.stringify(out)));
  }, 60_000);
});

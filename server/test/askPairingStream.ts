// The session stream harness Task Q3g's suites share (D-7031; plan 2026-10-26-consolidation-w3-questions.md, Task Q3g).
// One real `SessionStream` over a seeded home, its pane served from a recorded fixture and its hookstate written by
// the test, polled by hand (`session-stream-readings.test.ts`'s `pollOnce`), so a test never sleeps. Each scenario is
// one of Step 1's event orders: a list of steps, each setting the pane and the hook envelope and then polling once.
// Task C7q (D-7211, D-7220) adds, additively: a step may write the transcript's pending AskUserQuestion (`copy`, so the
// feed's `alignAsk` enriches the menu with `Dialog.ask`), write a blank envelope, reconnect (a new stream on the same
// home, `lastAskJson` undefined), or stand for an answer route (`answered`: the pane moves to `next` and the route's
// `answeredFrame` emits `answered:<id>` on the bus, recording the reply body beside the frames). Every Q3g scenario
// leaves those fields out and runs exactly as before.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Deps } from '../src/server.js';
import { SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Dialog, HookAsk, SessionStreamMsg } from '../../shared/api.js';
import { parseDialog } from '../src/pane/dialog.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
/** Q3a's corpus: the envelopes are read from it, so the stream and the table pair the same data. */
export const CORPUS = JSON.parse(readFileSync(path.join(ROOT, 'server/test/fixtures/ask-pairing/corpus.json'), 'utf8')) as {
  envelopes: Record<string, { questions: { question: string; multiSelect?: boolean; options: { label: string }[] }[] }>;
  rows: { why?: string; envelope: string; pane: string | null; patch?: unknown; expect: {
    corresponds: boolean[]; live: number | null; named: number | null;
    shown: { live: number | null; named: number | null; shown: number; placed: number | null }; screen: string | null;
  } }[];
};

/** A recorded pane by name (`fixtures/panes/<name>.txt`), or the busy pane (no menu) for `null`. */
const paneText = (name: string | null): string =>
  readFileSync(path.join(here, 'fixtures', 'panes', `${name ?? 'busy'}.txt`), 'utf8');

/** One step of an event order: the pane on screen (`null`: no menu), the hook's envelope (a corpus envelope's name,
 *  an approval, a blank question envelope, or `null`: no hookstate), then one poll.
 *  C7q's optional fields:
 *  - `copy`: the transcript's pending AskUserQuestion, a corpus envelope's name (its questions as the tool_use input),
 *    or `PARTIAL:<name>` (the same with its last option's label replaced, a copy that does not align: under four
 *    options `alignAsk` forgives no row, so the menu carries no `Dialog.ask`); absent or `null`, the transcript holds none;
 *  - `reconnect`: before this step's poll, stop the stream and connect a new one (its opening reading is this step's);
 *  - `answered`: instead of a poll, an answer route that saw the pane move to this step's `pane` (`null`: no menu):
 *    the route's reply body is recorded, and `answeredFrame` emits `answered:<id>` with the same `next`. */
export interface Step {
  pane: string | null;
  envelope: string | 'APPROVAL' | 'BLANK' | null;
  copy?: string | null;
  reconnect?: true;
  answered?: true;
}
export interface Scenario { name: string; steps: Step[] }

const APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'git push origin main' } };
/** A question envelope the hook wrote blank (the server's `'questions' in ask` holds, `isUsableAsk` does not). */
export const BLANK: HookAsk = { questions: [{ question: '   ', options: [{ label: 'Red' }, { label: 'Blue' }] }] };
export const envelopeOf = (e: Step['envelope']): HookAsk | null =>
  e === null ? null : e === 'APPROVAL' ? APPROVAL : e === 'BLANK' ? BLANK : { questions: CORPUS.envelopes[e]!.questions };

/** The transcript's AskUserQuestion input for a step's `copy`, or null for none. */
export const copyInput = (copy: string | null | undefined): { questions: unknown[] } | null => {
  if (copy === undefined || copy === null) return null;
  const partial = copy.startsWith('PARTIAL:');
  const env = CORPUS.envelopes[partial ? copy.slice('PARTIAL:'.length) : copy]!;
  return {
    questions: env.questions.map((q) => ({
      question: q.question, multiSelect: q.multiSelect === true,
      options: q.options.map((o, i) => ({ label: partial && i === q.options.length - 1 ? 'Not on screen' : o.label })),
    })),
  };
};

/** Step 1's event orders. */
export const SCENARIOS: readonly Scenario[] = [
  { name: 'dialog first', steps: [
    { pane: 'cc300-ask-1q-open', envelope: null },
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
  ] },
  { name: 'envelope first', steps: [
    { pane: null, envelope: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
  ] },
  { name: 'envelope changed under the same dialog', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: 'FRUIT_DRINK' },
  ] },
  { name: 'dialog repainted unparsed', steps: [
    { pane: 'cc300-ask-multiselect-next-open', envelope: 'COLOUR_FEATURES' },
    { pane: 'cc300-ask-multiselect-digit1', envelope: 'COLOUR_FEATURES' },
    { pane: 'cc300-ask-multiselect-digit1-3', envelope: 'COLOUR_FEATURES' },
  ] },
  { name: 'both cleared', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
    { pane: null, envelope: null },
  ] },
  { name: 'an approval envelope under a menu', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'APPROVAL' },
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: 'APPROVAL' },
  ] },
];

/** Task C7q's frame sequences (D-7211, D-7220): the server's own frame order around the transcript's copy, each run on a
 *  real `SessionStream` and recorded as `fixtures/ask-pairing/transcript-sequences.json` for C7f's store rows to replay.
 *  The envelope "ageing out" is the hook's envelope going away under the standing menu (`applyHook` reads none), the
 *  one branch an aged envelope that is not kept takes too. */
export const TRANSCRIPT_SEQUENCES: readonly Scenario[] = [
  { name: '(a) connect with a copy and no envelope', steps: [
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'COLOUR_ONE' },
  ] },
  { name: '(b) an envelope ageing out under a standing menu', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE', copy: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'COLOUR_ONE' },
  ] },
  { name: '(c) a reconnect mid-ask, with an envelope', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE', copy: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE', copy: 'COLOUR_ONE', reconnect: true },
  ] },
  { name: '(c) a reconnect mid-ask, without an envelope', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE', copy: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'COLOUR_ONE', reconnect: true },
  ] },
  { name: '(a) connect with a blank envelope and a copy', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'BLANK', copy: 'COLOUR_ONE' },
  ] },
  { name: '(d) a menu with no readable copy, then the envelope clearing', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'COLOUR_ONE', copy: 'PARTIAL:COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'PARTIAL:COLOUR_ONE' },
  ] },
  { name: '(e) an answer that moves the pane to the next question', steps: [
    { pane: 'cc300-ask-freetext-held', envelope: 'FRUIT_DRINK' },
    { pane: 'cc300-ask-q2-of-2-single', envelope: 'FRUIT_DRINK', answered: true },
  ] },
  { name: '(e) an answer whose next is no menu', steps: [
    { pane: 'cc300-ask-freetext-held', envelope: 'FRUIT_DRINK' },
    { pane: null, envelope: 'FRUIT_DRINK', answered: true },
  ] },
  { name: '(e) a dialog_cleared before the answer settles', steps: [
    { pane: 'cc300-ask-freetext-held', envelope: 'FRUIT_DRINK' },
    { pane: null, envelope: 'FRUIT_DRINK' },
    { pane: 'cc300-ask-q2-of-2-single', envelope: 'FRUIT_DRINK', answered: true },
  ] },
];

/** The frames the pairing rides or sits beside, in the order sent. */
export const PAIRING_FRAMES = new Set(['dialog', 'dialog_cleared', 'ask', 'ask_cleared']);

/** One frame sent, with the step it was sent on, and which connection sent it (0 the first, 1 after a reconnect). */
export interface Sent { step: number; frame: SessionStreamMsg; conn?: number }
/** An answer route's reply body (`server.ts`'s routes return `res` itself on success), recorded on its step. */
export interface Reply { step: number; body: { ok: true; next: Dialog | null } }

/** Run one scenario on a fresh home: connect (the opening reading), then each step's pane and envelope and one poll.
 *  Returns every `dialog`/`dialog_cleared`/`ask`/`ask_cleared` frame sent, with the step it was sent on (0 is the
 *  connect, which reads step 1's state). */
export async function runScenario(sc: Scenario): Promise<Sent[]> {
  return (await runSequence(sc)).frames;
}

/** `runScenario`, with the answer routes' reply bodies (C7q's sequence (e)) beside the frames. */
export async function runSequence(sc: Scenario): Promise<{ frames: Sent[]; replies: Reply[] }> {
  const home = mkTmp('ccrc-ask-pairing-stream-');
  try {
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const sess = path.join(home, '.claude-a', 'sessions');
    mkdirSync(sess, { recursive: true });
    writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.300',
    }));
    const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
    mkdirSync(tdir, { recursive: true });
    const transcript = path.join(tdir, `${UUID_A}.jsonl`);
    writeFileSync(transcript, '');
    const hookFile = path.join(reg, `${ID}.hookstate.json`);
    let current = paneText(null);
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: current, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), coord };
    let copied: string | null = null;
    const set = (s: Step): void => {
      current = paneText(s.pane);
      const copy = s.copy ?? null;
      if (copy !== copied) {
        copied = copy;
        const input = copyInput(copy);
        writeFileSync(transcript, input === null ? '' : `${JSON.stringify({
          type: 'assistant', message: { id: 'msg_c7q', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_c7q', name: 'AskUserQuestion', input }] },
        })}\n`);
      }
      const ask = envelopeOf(s.envelope);
      if (ask === null) rmSync(hookFile, { force: true });
      else writeFileSync(hookFile, JSON.stringify({
        v: 1, state: 'waiting', event: 'Notification', sessionId: UUID_A, pid: PID, updatedAt: Date.now(), subagents: [], ask,
      }));
    };
    const out: Sent[] = [];
    const replies: Reply[] = [];
    let step = 0;
    let conn = 0;
    const bus = new Bus();
    const connect = (n: number): SessionStream =>
      new SessionStream(deps, bus, ID, (m) => { if (PAIRING_FRAMES.has(m.type)) out.push(n === 0 ? { step, frame: m } : { step, frame: m, conn: n }); });
    set(sc.steps[0]!);
    let stream = connect(conn);
    try {
      await stream.start();
      for (let i = 0; i < sc.steps.length; i++) {
        step = i + 1;
        const s = sc.steps[i]!;
        set(s);
        if (s.reconnect === true) {
          stream.stop();
          conn += 1;
          stream = connect(conn);
          await stream.start();
        }
        if (s.answered === true) {
          // The route re-reads the pane it moved (`inject/send.ts`) and answers `{ ok: true, next }`; `answeredFrame`
          // emits `answered:<id>` with that `next` before the route replies.
          const next = s.pane === null ? null : parseDialog(current);
          bus.emit(`answered:${ID}`, next);
          replies.push({ step, body: { ok: true, next } });
          continue;
        }
        await (stream as unknown as { tick: () => Promise<void> }).tick();
        await (stream as unknown as { feed?: { poll(): Promise<void> } }).feed?.poll();
      }
    } finally { stream.stop(); }
    return { frames: out, replies };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

/** The frame as an older server sent it: the frame with any top-level `pairing` key taken off, and nothing else. */
export const withoutPairing = (f: SessionStreamMsg): SessionStreamMsg => {
  const { pairing: _p, ...rest } = f as SessionStreamMsg & { pairing?: unknown };
  return rest as SessionStreamMsg;
};

/** Q3a's table row for a recorded pane under a corpus envelope, as the wire's flat `pairing` shape. */
export const tablePairing = (pane: string, envelope: string): unknown => {
  const row = CORPUS.rows.find((r) => r.pane === pane && r.envelope === envelope && r.why === undefined && r.patch === undefined);
  if (row === undefined) throw new Error(`no table row for ${pane} x ${envelope}`);
  const e = row.expect;
  return { live: e.live, named: e.named, shown: e.shown.shown, placed: e.shown.placed, screen: e.screen, corresponds: e.corresponds };
};

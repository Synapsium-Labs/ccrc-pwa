// The session stream harness Task Q3g's suites share (D-7031; plan 2026-10-26-consolidation-w3-questions.md, Task Q3g).
// One real `SessionStream` over a seeded home, its pane served from a recorded fixture and its hookstate written by
// the test, polled by hand (`session-stream-readings.test.ts`'s `pollOnce`), so a test never sleeps. Each scenario is
// one of Step 1's event orders: a list of steps, each setting the pane and the hook envelope and then polling once.
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
import type { HookAsk, SessionStreamMsg } from '../../shared/api.js';
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
 *  an approval, or `null`: no hookstate), then one poll. */
export interface Step { pane: string | null; envelope: string | 'APPROVAL' | null }
export interface Scenario { name: string; steps: Step[] }

const APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'git push origin main' } };
export const envelopeOf = (e: Step['envelope']): HookAsk | null =>
  e === null ? null : e === 'APPROVAL' ? APPROVAL : { questions: CORPUS.envelopes[e]!.questions };

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

/** The frames the pairing rides or sits beside, in the order sent. */
export const PAIRING_FRAMES = new Set(['dialog', 'dialog_cleared', 'ask', 'ask_cleared']);

/** Run one scenario on a fresh home: connect (the opening reading), then each step's pane and envelope and one poll.
 *  Returns every `dialog`/`dialog_cleared`/`ask`/`ask_cleared` frame sent, with the step it was sent on (0 is the
 *  connect, which reads step 1's state). */
export async function runScenario(sc: Scenario): Promise<{ step: number; frame: SessionStreamMsg }[]> {
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
    writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), '');
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
    const set = (s: Step): void => {
      current = paneText(s.pane);
      const ask = envelopeOf(s.envelope);
      if (ask === null) rmSync(hookFile, { force: true });
      else writeFileSync(hookFile, JSON.stringify({
        v: 1, state: 'waiting', event: 'Notification', sessionId: UUID_A, pid: PID, updatedAt: Date.now(), subagents: [], ask,
      }));
    };
    const out: { step: number; frame: SessionStreamMsg }[] = [];
    let step = 0;
    set(sc.steps[0]!);
    const stream = new SessionStream(deps, new Bus(), ID, (m) => { if (PAIRING_FRAMES.has(m.type)) out.push({ step, frame: m }); });
    try {
      await stream.start();
      for (let i = 0; i < sc.steps.length; i++) {
        step = i + 1;
        set(sc.steps[i]!);
        await (stream as unknown as { tick: () => Promise<void> }).tick();
        await (stream as unknown as { feed?: { poll(): Promise<void> } }).feed?.poll();
      }
    } finally { stream.stop(); }
    return out;
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

// The backlog's tail (desktop polish wave 171, the coordinator's ruling on run 3609's question): an unterminated last
// line is not a record. The backlog holds its offset at the end of the last whole record, and the tailer delivers the
// held line whole, exactly once, once its newline lands. Fixture homes and temp files only.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBacklog, TranscriptTailer } from '../src/transcript/tail.js';
import type { HelperFact } from '../src/transcript/parse.js';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import type { Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'user', message: { role: 'user', content: text } })}\n`;
const launchLine = (id: string): string => `${JSON.stringify({
  type: 'user', uuid: `l-${id}`, timestamp: '2026-11-24T10:00:00.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: 'launched' }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId: id, description: 'd', resolvedModel: 'model-b', prompt: 'p' },
})}\n`;
const uuidsOf = (events: readonly ChatEvent[]): string[] => events.map((e) => ('uuid' in e ? `${e.uuid}` : '?'));
const tmpFile = (): string => path.join(mkTmp('ccrc-tail-held-'), 'transcript.jsonl');
const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Every event and helper fact a tailer from `offset` emits until `stop()`. */
const tail = (file: string, offset: number) => {
  const t = new TranscriptTailer(localIO, file, offset);
  const events: ChatEvent[] = [];
  const helpers: HelperFact[] = [];
  t.on('events', (e) => { events.push(...e); });
  t.on('helpers', (h) => { helpers.push(...h); });
  t.start();
  return { events, helpers, stop: () => t.stop() };
};

const tailers: Array<{ stop: () => void }> = [];
afterEach(() => { for (const t of tailers.splice(0)) t.stop(); });

describe('the held last line arrives exactly once, from the tailer', () => {
  it('a complete-JSON line whose newline had not landed: not in the backlog, then once from the tailer', { timeout: 10_000 }, async () => {
    const file = tmpFile();
    const held = userLine('held', 'complete but unterminated');
    writeFileSync(file, userLine('u1', 'one') + held.trimEnd());
    const b = await readBacklog(localIO, file, 50);
    expect(uuidsOf(b.events)).toEqual(['u1']);
    const t = tail(file, b.offset);
    tailers.push(t);
    await settle();
    expect(t.events).toEqual([]);
    appendFileSync(file, `\n${userLine('u2', 'two')}`);
    await settle(1500);
    expect(uuidsOf(t.events)).toEqual(['held', 'u2']);
  });

  it('a half-written line: not in the backlog, then once, whole, from the tailer', { timeout: 10_000 }, async () => {
    const file = tmpFile();
    const held = userLine('held', 'written in two parts');
    const cut = Math.floor(held.length / 2);
    writeFileSync(file, userLine('u1', 'one') + held.slice(0, cut));
    const b = await readBacklog(localIO, file, 50);
    expect(uuidsOf(b.events)).toEqual(['u1']);
    const t = tail(file, b.offset);
    tailers.push(t);
    appendFileSync(file, held.slice(cut));
    await settle(1500);
    expect(t.events).toEqual([{ kind: 'user', uuid: 'held', ts: '2026-11-24T10:00:00.000Z', text: 'written in two parts' }]);
  });

  it('a held helper fact is not in the backlog\'s facts and comes once from the tailer; the scan\'s seam does not move', { timeout: 10_000 }, async () => {
    const file = tmpFile();
    const held = launchLine('a1');
    writeFileSync(file, userLine('u1', 'one') + held.slice(0, 40));
    const b = await readBacklog(localIO, file, 50);
    expect(b.helpers ?? []).toEqual([]);
    expect(b.scanEnd).toBe(0);
    const t = tail(file, b.offset);
    tailers.push(t);
    appendFileSync(file, held.slice(40));
    await settle(1500);
    expect(t.helpers.map((h) => h.id)).toEqual(['a1']);
  });
});

describe('a resume that presents the held offset never shows the held line twice', () => {
  const ID = 'claude-a-project-f';
  const UUID_A = 'a'.repeat(36);
  const WORKDIR = '/data/projects/project-f';
  const MUNGED = '-data-projects-project-f';
  const PID = 40613;
  const streams: SessionStream[] = [];
  afterEach(() => { for (const s of streams.splice(0)) s.stop(); });

  const home = (transcript: string): { home: string; file: string } => {
    const h = mkTmp('ccrc-tail-held-home-');
    seedRoster(h);
    const reg = path.join(h, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' })) {
      writeFileSync(path.join(reg, `${ID}.${k}`), v);
    }
    mkdirSync(path.join(h, '.claude-a', 'sessions'), { recursive: true });
    writeFileSync(path.join(h, '.claude-a', 'sessions', `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const dir = path.join(h, '.claude-a', 'projects', MUNGED);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${UUID_A}.jsonl`);
    writeFileSync(file, transcript);
    return { home: h, file };
  };
  const deps = (h: string): Deps => {
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: h });
    return { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports };
  };
  const events = (frames: SessionStreamMsg[]): string[] =>
    frames.flatMap((f) => (f.type === 'backlog' || f.type === 'events' ? uuidsOf(f.events) : []));

  it('the first stream holds it back, the resumed stream shows it once its newline lands', { timeout: 15_000 }, async () => {
    const held = userLine('held', 'held across a reconnect');
    const { home: h, file } = home(userLine('u1', 'one') + held.slice(0, 30));
    const first: SessionStreamMsg[] = [];
    const s1 = new SessionStream(deps(h), new Bus(), ID, (m) => first.push(m), undefined, NO_TICK);
    streams.push(s1);
    await s1.start();
    const backlog = first.find((f) => f.type === 'backlog') as Extract<SessionStreamMsg, { type: 'backlog' }>;
    expect(uuidsOf(backlog.events)).toEqual(['u1']);
    s1.stop();
    const second: SessionStreamMsg[] = [];
    const s2 = new SessionStream(deps(h), new Bus(), ID, (m) => second.push(m), { uuid: UUID_A, offset: backlog.offset, file }, NO_TICK);
    streams.push(s2);
    await s2.start();
    expect(second.some((f) => f.type === 'backlog')).toBe(false);
    appendFileSync(file, held.slice(30));
    await settle(1500);
    expect([...events(first), ...events(second)]).toEqual(['u1', 'held']);
  });
});

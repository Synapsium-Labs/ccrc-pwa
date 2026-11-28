// A long paste sent as a file (desktop-polish wave 194): the server half, which changes nothing on the server. The
// console saves a pasted text through the existing upload under the neutral name `PASTE_UPLOAD_NAME`, and sends one
// pointer line naming the stored file (`shared/pastePointer.ts`). This file pins what that relies on: the upload
// stores the text byte for byte under a name the chat's reader accepts as this session's pointer; the prompt route
// takes the pointer text and the sender types it with no line over `PASTE_POINTER_MAX` (400) characters, half the
// collapse floor Claude Code folds a long line at; the sender's own patterns for Claude Code's paste label never match
// a pointer, at a line's start or anywhere; and the opened view is today's: `text/plain` with no charset (a known
// limit of every attached text document, left as it is in this wave).
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import {
  PASTE_POINTER_MAX, PASTE_UPLOAD_NAME, pastePointer, readPastePointer, splitPastePointers,
} from '../../shared/pastePointer.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'lane-a-project-a';
const here = path.dirname(fileURLToPath(import.meta.url));
const SEND_TS = readFileSync(path.join(here, '../src/inject/send.ts'), 'utf8');

/** A server over a one-session registry in a fixture home. The pane echoes what was typed and Enter empties it, so a
 *  send's proof completes at once; every literal the sender typed is kept, in order. */
async function makeApp(): Promise<{ app: FastifyInstance; literals: string[]; enters: () => number }> {
  const home = mkTmp('ccrc-pastepointer-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: ID, workdir: `/data/projects/${ID}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  let typed = '';
  let enters = 0;
  const literals: string[] = [];
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: `❯ ${typed.split('\n').join('\n  ')}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      const lit = args.indexOf('--');
      if (args.includes('-l') && lit >= 0) {
        const text = args.slice(lit + 1).join(' ');
        literals.push(text);
        typed += text;
      } else if (args.at(-1) === 'Enter') {
        enters += 1;
        typed = '';
      } else if (args.at(-1) === 'M-Enter' || args.at(-1) === 'S-Enter') {
        typed += '\n';
      }
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports },
    new Bus(),
  );
  return { app, literals, enters: () => enters };
}

const saveText = async (app: FastifyInstance, text: string): Promise<{ path: string; name: string }> => {
  const f = new FormData();
  f.append('file', new Blob([text], { type: 'text/plain' }), PASTE_UPLOAD_NAME);
  const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/upload`, payload: f });
  expect(res.statusCode).toBe(200);
  return res.json().clip as { path: string; name: string };
};

/** A regex literal the sender defines by name, read out of its own source (three of the four are not exported). */
const senderPattern = (name: string): RegExp => {
  const m = new RegExp(`^const ${name} = /(.+)/([a-z]*);$`, 'm').exec(SEND_TS);
  if (m === null) throw new Error(`send.ts no longer defines ${name}: re-read the sender before trusting this case`);
  return new RegExp(m[1]!, m[2]!);
};

describe('the saved file', () => {
  it('holds the pasted text byte for byte, under a name the chat reads as this session\'s pointer', async () => {
    const { app } = await makeApp();
    const text = `say "hi" | grep x 😀\n${'z'.repeat(5000)}\nend`;
    const clip = await saveText(app, text);
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-[0-9a-f]{8}-paste\.txt$/);
    expect(Buffer.compare(readFileSync(clip.path), Buffer.from(text, 'utf8'))).toBe(0);
    expect(readPastePointer(pastePointer(clip.path, 3), ID)).toEqual({ path: clip.path, name: clip.name, lines: 3 });
    await app.close();
  });

  it('opens as text/plain with no charset, as every attached text document does today', async () => {
    const { app } = await makeApp();
    const clip = await saveText(app, 'é😀');
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${clip.name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.toString('utf8')).toBe('é😀');
    await app.close();
  });
});

describe('the prompt route and the sender', () => {
  it(`take the pointer text and type it with no line over ${String(PASTE_POINTER_MAX)} characters`, async () => {
    const { app, literals, enters } = await makeApp();
    const clip = await saveText(app, 'x\n'.repeat(214));
    const text = `look at this\n${pastePointer(clip.path, 215)}\nand fix it`;
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(literals.join('\n')).toBe(text);
    for (const l of literals) expect(l.length).toBeLessThanOrEqual(PASTE_POINTER_MAX);
    expect(enters()).toBe(1);
    expect(splitPastePointers(literals.join('\n'), ID).map((p) => p.kind)).toEqual(['text', 'paste', 'text']);
    await app.close();
  });

  it('states its bound at half the sender\'s collapse floor', () => {
    const floor = Number(/^const PASTE_COLLAPSE_FLOOR = (\d+);$/m.exec(SEND_TS)?.[1]);
    expect(floor).toBe(800);
    expect(PASTE_POINTER_MAX * 2).toBeLessThanOrEqual(floor);
  });
});

describe('the sender\'s patterns for Claude Code\'s own paste label', () => {
  const patterns = ['PASTE_CHIP', 'LONE_PASTE_CHIP', 'BARE_PASTE_CHIP', 'ANY_PASTE_CHIP'].map((n) => [n, senderPattern(n)] as const);
  const path0 = `/home/user-a/.cc-clips/${ID}/clip-20261127-153012-1a2b3c4d-paste.txt`;

  it('are the four the sender reads', () => {
    expect(patterns.map(([n, re]) => [n, re.source])).toEqual([
      ['PASTE_CHIP', '^\\[Pasted text #\\d+'],
      ['LONE_PASTE_CHIP', '^\\[Pasted text #\\d+(?: \\+(\\d+) lines)?\\]$'],
      ['BARE_PASTE_CHIP', '^\\[Pasted text #\\d+\\]$'],
      ['ANY_PASTE_CHIP', '\\[Pasted text #\\d+'],
    ]);
  });

  for (const lines of [1, 214, 999_999_999]) {
    it(`match no pointer of ${String(lines)} line(s), at a line's start or anywhere in one`, () => {
      const p = pastePointer(path0, lines);
      for (const [name, re] of patterns) {
        for (const line of [p, `text before ${p}`, `${p} text after`]) expect(re.test(line), `${name}: ${line}`).toBe(false);
      }
    });
  }
});

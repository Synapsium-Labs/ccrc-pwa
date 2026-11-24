// Any file attaches (wave 172, the operator's goal of 2026-11-24). The upload
// route takes untrusted names and bytes, so this file is the security
// boundary's pins as much as the feature's: what any uploader can make the
// console store, what it can make the console serve, and what it cannot.
//
// The gate is the extension's SHAPE (`CLIP_EXT_ALT`: lower-case letters and
// digits, 1 to `CLIP_EXT_MAX`), never a list of formats, and every name the
// store writes must be one the name rule, the path pattern and the clip route
// all accept — a file that can be stored can be found and served.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { CLIP_MIME, CLIP_NAME_RE } from '../src/clip.js';
import {
  CLIP_EXT_MAX, CLIP_MAX_BYTES, CLIP_MAX_PER_MESSAGE, CLIP_PATH_RE, composePrompt, splitClipPaths,
} from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'lane-a-project-a';

/** A server over a one-session registry in a fixture home. The runner's pane
 *  echoes what was typed into it, and Enter empties it, so a send's proof
 *  completes at once rather than waiting out its deadline. */
async function makeApp(): Promise<{ app: FastifyInstance; home: string; clipsDir: string }> {
  const home = mkTmp('ccrc-anyfile-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: ID, workdir: `/data/projects/${ID}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  let typed = '';
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: `❯ ${typed}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      const lit = args.indexOf('--');
      if (args.includes('-l') && lit >= 0) typed += args.slice(lit + 1).join(' ');
      else if (args.at(-1) === 'Enter') typed = '';
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports },
    new Bus(),
  );
  return { app, home, clipsDir: cfg.clipsDir };
}

const form = (name: string, bytes: Uint8Array<ArrayBuffer> | string, type = '') => {
  const f = new FormData();
  f.append('file', new Blob([bytes], { type }), name);
  return f;
};

const upload = (app: FastifyInstance, name: string, bytes: Uint8Array<ArrayBuffer> | string = 'x', type = '') =>
  app.inject({ method: 'POST', url: `/api/sessions/${ID}/upload`, payload: form(name, bytes, type) });

type Clip = { path: string; name: string; bytes: number };

/** Every name the store writes: the stamp, 32 bits of suffix, an optional
 *  sanitised stem, and an extension of the admitted shape. Nothing else. */
const STORED = /^clip-\d{8}-\d{6}-[0-9a-f]{8}(?:-[A-Za-z0-9._-]+)?\.[a-z0-9]{1,12}$/;

/** Bytes no text path would carry intact: NUL, invalid UTF-8 lead and
 *  continuation bytes, a CR LF pair. */
const BINARY = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x80, 0xfd, 0xfe, 0xff, 0x0d, 0x0a, 0x1a]);

describe('the upload route stores any file', () => {
  it('stores an archive, an office document, a source file and an audio file, byte for byte', async () => {
    const { app, clipsDir } = await makeApp();
    for (const [name, ext] of [
      ['bundle.zip', 'zip'], ['memo.docx', 'docx'], ['deck.pptx', 'pptx'], ['main.ts', 'ts'],
      ['track.mp3', 'mp3'], ['run.sh', 'sh'], ['tool.exe', 'exe'], ['anim.gif', 'gif'],
    ] as const) {
      const res = await upload(app, name, BINARY, 'application/octet-stream');
      expect(res.statusCode, name).toBe(200);
      const clip = res.json().clip as Clip;
      expect(clip.name, name).toMatch(STORED);
      expect(clip.name.endsWith(`.${ext}`), name).toBe(true);
      expect(path.dirname(clip.path), name).toBe(path.join(clipsDir, ID));
      expect(Buffer.compare(readFileSync(clip.path), Buffer.from(BINARY)), name).toBe(0);
      expect(clip.bytes, name).toBe(BINARY.byteLength);
    }
    await app.close();
  });

  it('keeps the last extension of a double one, and the rest in the stem', async () => {
    const { app } = await makeApp();
    const clip = (await upload(app, 'backup.tar.gz', BINARY)).json().clip as Clip;
    expect(clip.name).toMatch(/-backup\.tar\.gz$/);
    await app.close();
  });

  it('stores an upper-case extension lower-cased', async () => {
    const { app } = await makeApp();
    for (const [name, tail] of [['REPORT.PDF', '-REPORT.pdf'], ['Photo.ZIP', '-Photo.zip'], ['a.Mp3', '-a.mp3']] as const) {
      const clip = (await upload(app, name)).json().clip as Clip;
      expect(clip.name, name).toMatch(STORED);
      expect(clip.name.endsWith(tail), name).toBe(true);
    }
    await app.close();
  });

  it(`takes an extension of exactly ${String(CLIP_EXT_MAX)} characters`, async () => {
    const { app } = await makeApp();
    const ext = 'a'.repeat(CLIP_EXT_MAX);
    const res = await upload(app, `x.${ext}`);
    expect(res.statusCode).toBe(200);
    expect((res.json().clip as Clip).name.endsWith(`.${ext}`)).toBe(true);
    await app.close();
  });

  // The composer never sends one of these: it gives the name `.noext` first.
  // The gate still refuses them from any other client, so nothing is stored
  // under a name the rest of the lane cannot find or serve.
  it('refuses a name with no usable extension: none, over-long, symbol-bearing, only dots, non-ASCII', async () => {
    const { app } = await makeApp();
    for (const name of [
      'README', 'Makefile', `x.${'a'.repeat(CLIP_EXT_MAX + 1)}`, 'x.t~t', 'x.tar-gz', 'x.a b', 'x.', '...', '.',
      'x.K', 'x.ſh',
    ]) {
      const res = await upload(app, name);
      expect(res.statusCode, JSON.stringify(name)).toBe(415);
      expect(res.json().error, name).toBe('unsupported-type');
    }
    await app.close();
  });

  it('stores what the composer sends for those: the name plus `.noext`', async () => {
    const { app } = await makeApp();
    for (const [name, tail] of [
      ['README.noext', '-README.noext'], ['x.t~t.noext', '-x.t-t.noext'], ['....noext', /^clip-\d{8}-\d{6}-[0-9a-f]{8}\.noext$/],
    ] as const) {
      const clip = (await upload(app, name)).json().clip as Clip;
      expect(clip.name, name).toMatch(STORED);
      if (typeof tail === 'string') expect(clip.name.endsWith(tail), name).toBe(true);
      else expect(clip.name, name).toMatch(tail);
    }
    await app.close();
  });
});

describe('the limits that remain', () => {
  it('stores a file of exactly the limit and refuses one byte more', async () => {
    const { app } = await makeApp();
    expect(CLIP_MAX_BYTES).toBe(12 * 1024 * 1024);
    const ok = await upload(app, 'big.zip', new Uint8Array(CLIP_MAX_BYTES));
    expect(ok.statusCode).toBe(200);
    expect((ok.json().clip as Clip).bytes).toBe(CLIP_MAX_BYTES);
    const over = await upload(app, 'big.zip', new Uint8Array(CLIP_MAX_BYTES + 1));
    expect(over.statusCode).toBe(413);
    expect(over.json().error).toBe('too-large');
    await app.close();
  });

  it(`refuses a message naming a fifth file, whatever its type`, async () => {
    const { app } = await makeApp();
    const paths: string[] = [];
    for (let i = 0; i <= CLIP_MAX_PER_MESSAGE; i++) paths.push(((await upload(app, `f${String(i)}.zip`)).json().clip as Clip).path);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi', attachments: paths } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-attachment');
    await app.close();
  });
});

describe('what an uploader cannot do with a name', () => {
  // A filename is the uploader's free text. None of it may choose the folder,
  // and none of it may reach the prompt except as the sanitised stem.
  const HOSTILE = [
    '../../.ssh/authorized_keys.pub', '/etc/passwd.txt', '..\\..\\win.ini', 'a\nb.txt', 'a\rb.txt',
    '$(touch pwned).sh', '`id`.py', 'x; rm -rf ~.txt', 'x && curl evil.sh', '-rf.sh', '--help.md',
    'name with spaces.zip', '«quoted».docx', '💥.bin', 'nul\u0000byte.txt', `${'a'.repeat(400)}.zip`,
  ];

  it('stores every hostile name inside the session folder, under the stored-name rule', async () => {
    const { app, clipsDir } = await makeApp();
    for (const name of HOSTILE) {
      const res = await upload(app, name);
      if (res.statusCode === 415) continue;   // no usable extension after the last dot: stored nowhere
      expect(res.statusCode, JSON.stringify(name)).toBe(200);
      const clip = res.json().clip as Clip;
      expect(clip.name, JSON.stringify(name)).toMatch(STORED);
      expect(CLIP_NAME_RE.test(clip.name), JSON.stringify(name)).toBe(true);
      expect(clip.path, JSON.stringify(name)).toBe(path.join(clipsDir, ID, clip.name));
    }
    await app.close();
  });

  it('puts nothing into the prompt but the stored path, which the path pattern finds whole', async () => {
    const { app } = await makeApp();
    for (const name of HOSTILE) {
      const res = await upload(app, name);
      if (res.statusCode !== 200) continue;
      const clip = res.json().clip as Clip;
      const prompt = composePrompt('look', [clip.path]);
      expect(prompt, JSON.stringify(name)).toBe(`${clip.path}\nlook`);
      expect(clip.path, JSON.stringify(name)).not.toMatch(/[\s$`;&|<>()\\'"]/);
      expect(splitClipPaths(prompt), JSON.stringify(name)).toEqual({ paths: [clip.path], rest: 'look' });
    }
    await app.close();
  });

  it('accepts a staged non-picture in a prompt, typed as its path', async () => {
    const { app } = await makeApp();
    const clip = (await upload(app, 'bundle.zip', BINARY)).json().clip as Clip;
    expect(CLIP_PATH_RE.test(clip.path)).toBe(true);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: '', attachments: [clip.path] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('nothing stored is executable', () => {
  // Nothing runs because it was uploaded: the store writes a plain file, and a
  // `.sh` or an `.exe` lands without an execute bit for anyone.
  it('stores a script and a program with no execute bit', async () => {
    const { app } = await makeApp();
    for (const name of ['run.sh', 'tool.exe', 'x.py']) {
      const clip = (await upload(app, name, '#!/bin/sh\necho hi\n')).json().clip as Clip;
      expect(statSync(clip.path).mode & 0o111, name).toBe(0);
    }
    await app.close();
  });
});

describe('serving back stays an allow-list', () => {
  const served = async (name: string, body: string | Uint8Array<ArrayBuffer>) => {
    const { app } = await makeApp();
    const clip = (await upload(app, name, body)).json().clip as Clip;
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${clip.name}` });
    await app.close();
    return res;
  };

  // The two the brief names: an uploaded page and an uploaded vector image
  // must never render from the console's own address. Opaque type plus
  // `nosniff` is a download in every browser.
  for (const [name, body] of [
    ['page.html', '<!doctype html><script>fetch("/api/sessions")</script>'],
    ['vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['page.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>'],
    ['code.js', 'alert(1)'], ['code.mjs', 'alert(1)'], ['data.xml', '<x/>'], ['page.htm', '<script>alert(1)</script>'],
  ] as const) {
    it(`serves an uploaded ${name} as an opaque download, never as markup`, async () => {
      const res = await served(name, body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.rawPayload.toString('utf8')).toBe(body);
    });
  }

  it('serves any other extension as an opaque download, its bytes intact', async () => {
    const res = await served('bundle.zip', BINARY);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.compare(res.rawPayload, Buffer.from(BINARY))).toBe(0);
  });

  // `constructor` is a lower-case word of the admitted shape, and on a plain
  // object literal `CLIP_MIME['constructor']` is `Object` itself.
  it('serves an extension that names an Object.prototype member as an opaque download', async () => {
    const res = await served('x.constructor', 'x');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  it('names no type a browser would run, on a table with no prototype to inherit one from', () => {
    for (const [ext, mime] of Object.entries(CLIP_MIME)) {
      expect(mime, ext).not.toMatch(/html|svg|xml|javascript|ecmascript/i);
    }
    expect(Object.getPrototypeOf(CLIP_MIME)).toBeNull();
    expect(Object.isFrozen(CLIP_MIME)).toBe(true);
    for (const k of ['constructor', 'tostring', 'valueof', 'hasownproperty']) expect(CLIP_MIME[k], k).toBeUndefined();
  });
});

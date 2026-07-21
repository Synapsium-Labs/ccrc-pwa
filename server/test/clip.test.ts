import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';

const ID = 'claude2-MekWarLive';
// PNG magic + a few header bytes — the server never inspects content, only the filename ext.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const seedSession = (home: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = {
    wrapper: 'claude2', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
    uuid: '1'.repeat(36), started: '1',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};

/** Build a multipart/form-data body with a single `file` field. */
function multipart(filename: string, contentType: string, data: Buffer): {
  payload: Buffer; headers: Record<string, string>;
} {
  const boundary = 'ccrcTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n`
      + `content-disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `content-type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Server whose runner records every call plus whether argv[1] existed on disk at call time. */
async function makeApp(opts: { fail?: boolean } = {}): Promise<{
  app: FastifyInstance;
  cfg: CcrcConfig;
  calls: { argv: string[]; fileExisted: boolean }[];
}> {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
  seedSession(home);
  const calls: { argv: string[]; fileExisted: boolean }[] = [];
  const run: Runner = async (cmd, args) => {
    calls.push({ argv: [cmd, ...args], fileExisted: existsSync(args[1] ?? '') });
    return opts.fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer({ cfg, run, tmux: new Tmux(run), io: localIO });
  return { app, cfg, calls };
}

describe('POST /api/sessions/:id/upload', () => {
  it('saves the png under uploadsDir before running ccd clip with exact argv', async () => {
    const { app, cfg, calls } = await makeApp();
    const { payload, headers } = multipart('shot.png', 'image/png', PNG);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/upload`, payload, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    const { argv, fileExisted } = calls[0]!;
    expect(argv[0]).toBe(cfg.ccdBin);
    expect(argv[1]).toBe('clip');
    expect(argv[3]).toBe(ID);
    expect(argv).toHaveLength(4);
    const file = argv[2]!;
    expect(path.dirname(file)).toBe(cfg.uploadsDir);
    expect(path.basename(file)).toMatch(/^upload-\d+-[0-9a-f]{6}\.png$/);
    expect(fileExisted).toBe(true);                       // file landed before the runner call
    expect(readFileSync(file)).toEqual(PNG);              // ccd clip moves it; stub runner leaves it in place
    await app.close();
  });

  it('rejects a .txt upload with 415 without touching ccd', async () => {
    const { app, calls } = await makeApp();
    const { payload, headers } = multipart('notes.txt', 'text/plain', Buffer.from('hello'));
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/upload`, payload, headers });
    expect(res.statusCode).toBe(415);
    expect(calls).toEqual([]);
    await app.close();
  });

  it('maps a failing ccd clip to 502 with stderr', async () => {
    const { app, calls } = await makeApp({ fail: true });
    const { payload, headers } = multipart('shot.jpg', 'image/jpeg', PNG);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/upload`, payload, headers });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
    expect(calls).toHaveLength(1);
    await app.close();
  });
});

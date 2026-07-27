// Staging, not clipping: the upload lands in ~/.cc-clips/<id>/ and its path is
// RETURNED. Nothing is typed into the session — that happens once, at send.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { clipName, clipPath, stageUpload, CLIP_NAME_RE } from '../src/clip.js';

const ID = 'claude2-MekWarLive';
const cfgFor = () => loadConfig({ CCRC_HOME: mkdtempSync(path.join(tmpdir(), 'ccrc-')) });

describe('clipName', () => {
  it('keeps the real extension — a JPEG must not be named .png', () => {
    expect(clipName('jpg', Date.parse('2026-07-26T15:03:40Z'), 'a1b2'))
      .toMatch(/^clip-\d{8}-\d{6}-a1b2\.jpg$/);
  });

  it('separates two clips filed in the same second', () => {
    const t = Date.parse('2026-07-26T15:03:40Z');
    expect(clipName('png', t, 'a1b2')).not.toBe(clipName('png', t, 'c3d4'));
  });
});

describe('clipPath', () => {
  it('refuses a session id that would escape the clips dir', () => {
    expect(() => clipPath('/home/u/.cc-clips', '../../.ssh', 'clip-x.png')).toThrow('bad-session-id');
    expect(() => clipPath('/home/u/.cc-clips', '..', 'clip-x.png')).toThrow('bad-session-id');
    expect(() => clipPath('/home/u/.cc-clips', 'a/b', 'clip-x.png')).toThrow('bad-session-id');
  });

  it('refuses an id that is not a single path segment', () => {
    for (const bad of ['', '.', '..', 'a/b', '/etc', 'a\\b', 'a\0b']) {
      expect(() => clipPath('/home/u/.cc-clips', bad, 'clip-x.png')).toThrow('bad-session-id');
    }
  });

  it('accepts every real session id shape', () => {
    for (const ok of ['claude2-OpenClawHetzner', 'claude-corp-data-internal', 'gpt-MekWarLive']) {
      expect(clipPath('/home/u/.cc-clips', ok, 'clip-x.png')).toBe(`/home/u/.cc-clips/${ok}/clip-x.png`);
    }
  });

  it('builds the path for a well-formed id', () => {
    expect(clipPath('/home/u/.cc-clips', ID, 'clip-x.png'))
      .toBe(`/home/u/.cc-clips/${ID}/clip-x.png`);
  });

  it('refuses a name that could climb out of the session directory', () => {
    for (const bad of ['../../.ssh/authorized_keys', '../x.png', 'a/b.png', '..', '.', '',
                       'notaclip.png', 'clip-x.exe', 'clip-x.png/../../y.png']) {
      expect(() => clipPath('/home/u/.cc-clips', 'claude2-Proj', bad)).toThrow(/bad-clip-name|bad-session-id/);
    }
  });

  it('accepts the names clipName actually produces', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const name = clipName(ext, Date.parse('2026-07-26T15:03:40Z'), 'a1b2');
      expect(CLIP_NAME_RE.test(name)).toBe(true);
      expect(clipPath('/home/u/.cc-clips', 'claude2-Proj', name))
        .toBe(`/home/u/.cc-clips/claude2-Proj/${name}`);
    }
  });
});

describe('stageUpload', () => {
  it('writes the bytes under the session and returns where they went', async () => {
    const cfg = cfgFor();
    const data = Buffer.from('screenshot-bytes');
    const clip = await stageUpload(localIO, cfg, ID, data, 'png',
      Date.parse('2026-07-26T15:03:40Z'), 'a1b2');

    expect(clip.path).toBe(path.join(cfg.clipsDir, ID, clip.name));
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-a1b2\.png$/);
    expect(clip.bytes).toBe(data.byteLength);
    expect(readFileSync(clip.path)).toEqual(data);
  });

  // Multi-image paste makes same-second uploads the DESIGNED flow, and a
  // collision is not a retry — stageUpload overwrites, both chips report the
  // same path, and the composed prompt silently carries one image instead of
  // two. The clip route serves it `immutable`, so a wrong-bytes cache entry is
  // permanent. 16 bits made that a ~1-in-11,000 event per four-image send.
  it('defaults to 32 bits of collision suffix, not 16', async () => {
    const cfg = cfgFor();
    const clip = await stageUpload(localIO, cfg, ID, Buffer.from('x'), 'png',
      Date.parse('2026-07-26T15:03:40Z'));
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
  });

  it('does not overwrite a clip filed in the same second', async () => {
    const cfg = cfgFor();
    const t = Date.parse('2026-07-26T15:03:40Z');
    const names = new Set<string>();
    for (let i = 0; i < 64; i++) {
      names.add((await stageUpload(localIO, cfg, ID, Buffer.from(`img${i}`), 'png', t)).name);
    }
    expect(names.size).toBe(64);
  });

  it('throws rather than writing outside the clips dir', async () => {
    const cfg = cfgFor();
    await expect(stageUpload(localIO, cfg, '../../.ssh', Buffer.from('x'), 'png'))
      .rejects.toThrow('bad-session-id');
  });
});

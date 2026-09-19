// Staging, not clipping: the upload lands in ~/.cc-clips/<id>/ and its path is
// RETURNED. Nothing is typed into the session — that happens once, at send.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { clipName, clipPath, clipStem, stageUpload, CLIP_MIME, CLIP_NAME_RE } from '../src/clip.js';
import { CLIP_DOC_EXTS, CLIP_EXTS, CLIP_IMAGE_EXTS } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude2-MekWarLive';
const cfgFor = () => {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  return loadConfig({ CCRC_HOME: home });
};

describe('clipName', () => {
  it('keeps the real extension — a JPEG must not be named .png', () => {
    expect(clipName('jpg', Date.parse('2026-07-26T15:03:40Z'), 'a1b2'))
      .toMatch(/^clip-\d{8}-\d{6}-a1b2\.jpg$/);
  });

  it('separates two clips filed in the same second', () => {
    const t = Date.parse('2026-07-26T15:03:40Z');
    expect(clipName('png', t, 'a1b2')).not.toBe(clipName('png', t, 'c3d4'));
  });

  // Four documents in one prompt are four paths and nothing else. Without the
  // stem they are four names differing only in a random suffix, and the reader
  // on the far end — Claude, opening them off those paths — cannot tell which
  // is the spec and which is the log without opening all four.
  it('carries the uploader\'s own name, after the collision suffix', () => {
    expect(clipName('md', Date.parse('2026-07-26T15:03:40Z'), 'a1b2', 'design-notes'))
      .toMatch(/^clip-\d{8}-\d{6}-a1b2-design-notes\.md$/);
  });

  it('is the original shape when there is no stem to carry', () => {
    expect(clipName('png', Date.parse('2026-07-26T15:03:40Z'), 'a1b2'))
      .toMatch(/^clip-\d{8}-\d{6}-a1b2\.png$/);
  });
});

describe('clipStem', () => {
  it('keeps a name that is already made of what a clip name admits', () => {
    expect(clipStem('design-notes.md')).toBe('design-notes');
    expect(clipStem('report_v2.final.pdf')).toBe('report_v2.final');
  });

  it('replaces everything a clip name does not admit', () => {
    expect(clipStem('Q3 report (final).pdf')).toBe('Q3-report-final');
    expect(clipStem('счёт №7.txt')).toBe('7');
  });

  it('drops the directory part — a filename field can carry a whole path', () => {
    expect(clipStem('/etc/passwd.txt')).toBe('passwd');
    expect(clipStem('../../secrets.md')).toBe('secrets');
  });

  it('never opens with a dot or a dash, so the stem cannot look like a flag or a dotfile', () => {
    expect(clipStem('...hidden.md')).toBe('hidden');
    expect(clipStem('--rf.txt')).toBe('rf');
  });

  it('caps a pathological name rather than letting it eat the whole filename', () => {
    expect(clipStem(`${'a'.repeat(300)}.txt`)).toHaveLength(40);
  });

  it('gives back nothing when nothing survives, which is the stemless shape', () => {
    expect(clipStem('....md')).toBe('');
    expect(clipStem('.md')).toBe('');
  });

  // The whole point of sanitising: whatever comes out must compose into a name
  // the writer's own gate accepts, or the upload 400s AFTER the bytes arrived.
  it('always composes into a name CLIP_NAME_RE admits', () => {
    const hostile = [
      '../../.ssh/authorized_keys', 'a/b', 'x\\y', 'sp ace', '«quoted»', '💥',
      'x'.repeat(300), '..', '.', '', 'null\u0000byte',
    ];
    for (const raw of hostile) {
      const name = clipName('md', Date.parse('2026-07-26T15:03:40Z'), 'a1b2', clipStem(raw));
      expect(CLIP_NAME_RE.test(name), raw).toBe(true);
      expect(clipPath('/home/u/.cc-clips', 'claude2-Proj', name))
        .toBe(`/home/u/.cc-clips/claude2-Proj/${name}`);
    }
  });
});

describe('the admitted extension list', () => {
  // The list is enumerated once in shared/api.ts and DERIVED everywhere. These
  // hold the derivations to it: a new extension that reaches one gate and not
  // another strands a staged file behind a 400 or serves it as a download.
  it('admits every extension the store claims to, and nothing else', () => {
    for (const ext of CLIP_EXTS) {
      const name = clipName(ext, Date.parse('2026-07-26T15:03:40Z'), 'a1b2');
      expect(CLIP_NAME_RE.test(name), ext).toBe(true);
    }
    for (const ext of ['exe', 'sh', 'svg', 'html', 'docx', 'xlsx', 'zip', 'gif']) {
      expect(CLIP_NAME_RE.test(`clip-20260726-150340-a1b2.${ext}`), ext).toBe(false);
    }
  });

  it('gives every admitted extension a Content-Type', () => {
    expect(CLIP_EXTS.filter((e) => CLIP_MIME[e] === undefined)).toEqual([]);
  });

  // These are bytes a client uploaded, served back from the app's own origin.
  // A script type in this table would make the clip route a same-origin script
  // host; `.docx` is absent for a different reason (Read cannot open a ZIP),
  // and this is the one that is a security property rather than a judgement.
  it('names no type a browser would execute in our own origin', () => {
    for (const [ext, mime] of Object.entries(CLIP_MIME)) {
      expect(mime, ext).not.toMatch(/html|xhtml|svg|javascript|ecmascript/i);
    }
  });

  it('splits into images and documents with nothing in both and nothing left over', () => {
    expect(CLIP_EXTS).toEqual([...CLIP_IMAGE_EXTS, ...CLIP_DOC_EXTS]);
    expect(CLIP_IMAGE_EXTS.filter((e) => (CLIP_DOC_EXTS as readonly string[]).includes(e))).toEqual([]);
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
    for (const ext of CLIP_EXTS) {
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

  it('carries the sanitised stem into the name it writes', async () => {
    const cfg = cfgFor();
    const clip = await stageUpload(localIO, cfg, ID, Buffer.from('# heading'), 'md',
      Date.parse('2026-07-26T15:03:40Z'), 'a1b2', clipStem('Q3 report.md'));
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-a1b2-Q3-report\.md$/);
    expect(readFileSync(clip.path, 'utf8')).toBe('# heading');
  });

  // The document half exists so the bytes reach a READER untouched. Nothing on
  // this path transcodes, and nothing may start to.
  it('writes a document byte-identical, including bytes that are not valid UTF-8', async () => {
    const cfg = cfgFor();
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x80, 0xfd, 0xff]);
    const clip = await stageUpload(localIO, cfg, ID, data, 'pdf',
      Date.parse('2026-07-26T15:03:40Z'), 'a1b2');
    expect(Buffer.compare(readFileSync(clip.path), data)).toBe(0);
  });

  it('throws rather than writing outside the clips dir', async () => {
    const cfg = cfgFor();
    await expect(stageUpload(localIO, cfg, '../../.ssh', Buffer.from('x'), 'png'))
      .rejects.toThrow('bad-session-id');
  });
});

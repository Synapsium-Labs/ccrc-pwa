// Native Docs HTML artifacts X5, plan Task A3.1: the artifact wrapper (spec sections 3.3, 3.4, 4.1, 4.2 and 4.5). The real artifact
// instance is built over a real capability store with a fake clock and a fake liveness, fixture capabilities are minted with
// `store.mint`, and every request is an `app.inject` naming the artifact host. The sandbox list, the header set and the CSP's
// directive order are written HERE from the spec and never imported, so a changed constant in the source is a red test.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ARTIFACT_IDLE_MS } from '../../shared/artifacts.js';
import type { DocPin, DocSectionSlug } from '../../shared/docs.js';
import { artifactConfig } from '../src/artifacts/policy.js';
import type { ArtifactConfig } from '../src/artifacts/policy.js';
import type { ArtifactBytes, SessionLiveness } from '../src/artifacts/ports.js';
import { buildArtifactServer } from '../src/artifacts/routes.js';
import { createArtifactStore, type ArtifactManifestEntry, type CapabilityInput } from '../src/artifacts/store.js';
import { ARTIFACT_ENDED_BODY, WRAPPER_FRAME_NAME } from '../src/artifacts/wrapper.js';

const ART = 'art.artifacts.invalid';
const CONTENT = 'content.artifacts.invalid';
const CONTENT_ORIGIN = `https://${CONTENT}`;
const CONSOLE_ORIGIN = 'https://console.example.test';
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const SHA = 'b'.repeat(64);
const SESSION = 'c0ffee'.repeat(10) + 'abcd';
/** A value shaped like the box token, planted where a leak could carry it. */
const BOX_TOKEN = `boxtok_${'Q'.repeat(40)}`;

/** Spec 4.2, written out: the frame's sandbox tokens, in order, and the three it must never hold. */
const SPEC_SANDBOX = ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals', 'allow-downloads', 'allow-pointer-lock'];
const NEVER = ['allow-top-navigation', 'allow-popups-to-escape-sandbox', 'allow-storage-access-by-user-activation'];
const ENDED_SENTENCE = 'This artifact link has ended. Open it again from ccrc.';
const FORBIDDEN = 'Forbidden.';

type On = Extract<ArtifactConfig, { state: 'on' }>;
function onConfig(): On {
  const c = artifactConfig({ origin: `https://${ART}`, content: CONTENT_ORIGIN, port: '7790' }, CONSOLE_ORIGIN, 7788);
  if (c.state !== 'on') throw new Error(`the fixture config is not on: ${JSON.stringify(c)}`);
  return c;
}

let toClose: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const a of toClose) await a.close().catch(() => {});
  toClose = [];
});

/** Every answer this file's requests received, for the "no secret" case to read. */
const seen: { status: number; headers: Record<string, unknown>; body: string }[] = [];

let counter = 0;
/** A well-formed, distinct token per draw: 43 base64url characters. */
const nextToken = (): string => `t${String(++counter).padStart(42, '0')}`;

function rig() {
  let now = T0;
  const ended = new Set<string>();
  const liveness: SessionLiveness = { of: (h) => (ended.has(h) ? 'ended' : 'live') };
  const store = createArtifactStore(() => now, liveness, nextToken, () => `id${++counter}`);
  // The content door (X5 A3.3) is not used here: a port that reads nothing, and the real clock.
  const bytes: ArtifactBytes = { prepare: async () => ({ ok: false, error: 'unreadable' }), read: async () => ({ ok: false, error: 'unreadable' }) };
  const app = buildArtifactServer({ cfg: onConfig(), store, bytes, now: () => Date.now() });
  toClose.push(app);
  return {
    store, app, ended,
    advance: (ms: number): void => { now += ms; },
    /** One GET of `/a/<token>` with the given fetch destination (no such header when `dest` is null). */
    async get(token: string, dest: string | null = 'document', method: 'GET' | 'HEAD' = 'GET') {
      const headers: Record<string, string> = { host: ART };
      if (dest !== null) headers['sec-fetch-dest'] = dest;
      const res = await app.inject({ method, url: `/a/${token}`, headers });
      seen.push({ status: res.statusCode, headers: { ...res.headers }, body: res.body });
      return res;
    },
  };
}

const entry = (rel: string): ArtifactManifestEntry => ({ rel, pin: { kind: 'blob', sha: SHA }, size: 10, mime: 'text/html', committed: true });

function committedInput(over: Partial<CapabilityInput> = {}): CapabilityInput {
  const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: 'main', section: 'specs', path: 'x/page.html' };
  return {
    sessionIdHash: SESSION, project: 'project-a', pin, ref: { commit: COMMIT, served: 'main' }, section: 'specs', dir: 'x',
    page: 'x/page.html', manifest: new Map([['x/page.html', entry('x/page.html')], [BOX_TOKEN, entry(BOX_TOKEN)]]),
    origins: [`https://api.example.test/${BOX_TOKEN}`], windows: false, ...over,
  };
}

function draftInput(over: Partial<CapabilityInput> = {}): CapabilityInput {
  const pin: DocPin = { kind: 'draft', branch: 'ws/topic', head: COMMIT, section: 'specs', path: 'x/page.html', fp: SHA };
  return committedInput({ pin, ...over });
}

function mint(r: ReturnType<typeof rig>, input: CapabilityInput): { token: string; id: string } {
  const m = r.store.mint(input);
  if (!m.ok) throw new Error(`mint refused: ${m.error}`);
  return { token: m.token, id: m.id };
}

/** One attribute's value from a start tag, HTML-unescaped; null when the tag has no such attribute. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (m === null) return null;
  return m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const iframeTag = (html: string): string => /<iframe\b[^>]*>/i.exec(html)![0];
const clearTag = (html: string): string => /<a\b[^>]*\bhref="[^"]*\/clear"[^>]*>/i.exec(html)![0];
const styleText = (html: string): string => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
/** The document's text with its tags and style removed, tags replaced by one space. */
const textOf = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('wrapper: the frame', () => {
  it('wrapper: sandbox is exactly the base, plus allow-popups only with windows', async () => {
    const r = rig();
    const plain = mint(r, committedInput());
    const win = mint(r, committedInput({ windows: true }));
    const a = await r.get(plain.token);
    expect(a.statusCode).toBe(200);
    const sandbox = attr(iframeTag(a.body), 'sandbox')!;
    expect(sandbox.split(' ')).toEqual(SPEC_SANDBOX);
    expect(sandbox).toBe(SPEC_SANDBOX.join(' '));
    const b = await r.get(win.token);
    const sandboxWin = attr(iframeTag(b.body), 'sandbox')!;
    expect(sandboxWin).toBe(`${SPEC_SANDBOX.join(' ')} allow-popups`);
    for (const never of NEVER) {
      expect(sandbox.split(' ')).not.toContain(never);
      expect(sandboxWin.split(' ')).not.toContain(never);
      expect(a.body).not.toContain(never);
      expect(b.body).not.toContain(never);
    }
  });

  it('wrapper: allow, the frame name and the clear link', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const res = await r.get(token);
    const frame = iframeTag(res.body);
    expect(attr(frame, 'allow')).toBe('fullscreen; clipboard-write');
    expect(attr(frame, 'referrerpolicy')).toBe('no-referrer');
    const name = attr(frame, 'name');
    expect(name).toBe(WRAPPER_FRAME_NAME);
    expect(name).not.toBe('');
    const clear = clearTag(res.body);
    expect(attr(clear, 'target')).toBe(name);
    expect(attr(clear, 'href')).toBe(`${CONTENT_ORIGIN}/clear`);
    expect(textOf(res.body)).toContain("Clear this host's data");
  });

  it('wrapper: src is the content URL with each segment percent-encoded', async () => {
    const r = rig();
    // The page's file name holds a space, `#`, `?`, a non-ASCII letter and a quote; its directory holds a `%`.
    const file = "a b#c?d é'.html";
    const dir = '100%/sub';
    const page = `${dir}/${file}`;
    const { token } = mint(r, committedInput({ dir, page, manifest: new Map([[page, entry(page)]]) }));
    const res = await r.get(token);
    expect(attr(iframeTag(res.body), 'src')).toBe(`${CONTENT_ORIGIN}/c/${token}/${encodeURIComponent(file)}`);
    expect(attr(iframeTag(res.body), 'src')).toContain('a%20b%23c%3Fd%20%C3%A9');
    // A page at the section root has no directory to strip.
    const root = mint(r, committedInput({ dir: '', page: 'top page.html', manifest: new Map([['top page.html', entry('top page.html')]]) }));
    const rootRes = await r.get(root.token);
    expect(attr(iframeTag(rootRes.body), 'src')).toBe(`${CONTENT_ORIGIN}/c/${root.token}/top%20page.html`);
  });

  it('wrapper: the document holds no script', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const res = await r.get(token);
    expect(res.statusCode).toBe(200);
    expect(res.body.toLowerCase()).not.toContain('<script');
    expect(res.body.toLowerCase()).not.toMatch(/\son[a-z]+=/);
    expect(res.body.toLowerCase()).not.toContain('javascript:');
  });

  it('wrapper: the stylesheet loads nothing', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const css = styleText((await r.get(token)).body);
    expect(css).not.toMatch(/@import/i);
    expect(css.replace(/url\(\s*["']?data:/gi, '')).not.toMatch(/url\(/i);
    expect(css).not.toContain('<');
  });
});

describe('wrapper: the escaping', () => {
  it('wrapper: values are escaped, in text and in attributes', async () => {
    const r = rig();
    const hostile = `<b a="1" b='2'>&amp;`;
    const escaped = '&lt;b a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;amp;';
    const page = `x/${hostile}.html`;
    const { token } = mint(r, draftInput({
      project: hostile, section: hostile as DocSectionSlug, dir: 'x', page, manifest: new Map([[page, entry(page)]]),
      pin: { kind: 'draft', branch: hostile, head: COMMIT, section: 'specs', path: page, fp: SHA },
    }));
    const res = await r.get(token);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(hostile);
    expect(res.body).not.toContain('<b a=');
    expect(res.body).not.toContain('<b ');
    // The project and the section and page path appear, escaped, in the title and the bar.
    expect(res.body).toContain(`Artifact · ${escaped} · ${escaped}/x/${escaped}.html`);
    // The page in the frame's src is percent-encoded, so the raw characters are not in it either.
    const src = attr(iframeTag(res.body), 'src')!;
    expect(src).toBe(`${CONTENT_ORIGIN}/c/${token}/${encodeURIComponent(`${hostile}.html`)}`);
    // Each tag-opening in the document is one of the fixed tags: nothing of the hostile value opened an element.
    const tags = [...res.body.matchAll(/<([a-z!/][a-z0-9-]*)/gi)].map((m) => m[1]!.toLowerCase());
    expect(new Set(tags)).toEqual(new Set(['!doctype', 'html', 'head', 'meta', 'title', '/title', 'style', '/style', '/head', 'body',
      'div', 'span', '/span', 'a', '/a', '/div', 'iframe', '/iframe', '/body', '/html']));
  });
});

describe('wrapper: the headers', () => {
  it('wrapper: the headers are exactly the spec\'s', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const res = await r.get(token);
    expect(res.statusCode).toBe(200);
    const hash = createHash('sha256').update(styleText(res.body)).digest('base64');
    const spec: Record<string, string> = {
      'content-security-policy': `default-src 'none'; style-src 'sha256-${hash}'; img-src data:; frame-src ${CONTENT_ORIGIN}/c/${token}/ ${CONTENT_ORIGIN}/clear; `
        + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'cross-origin-opener-policy': 'same-origin-allow-popups',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    };
    for (const [k, v] of Object.entries(spec)) expect(res.headers[k], k).toBe(v);
    const others = new Set(['content-type', 'content-length', 'date', 'connection', 'keep-alive', 'transfer-encoding']);
    expect(Object.keys(res.headers).filter((k) => !(k in spec) && !others.has(k))).toEqual([]);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('wrapper: frame-src names the capability path and /clear', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const csp = String((await r.get(token)).headers['content-security-policy']);
    const frameSrc = csp.split('; ').find((d) => d.startsWith('frame-src '))!;
    expect(frameSrc.split(' ').slice(1)).toEqual([`${CONTENT_ORIGIN}/c/${token}/`, `${CONTENT_ORIGIN}/clear`]);
    expect(frameSrc.split(' ')).not.toContain(CONTENT_ORIGIN);
    expect(frameSrc.split(' ')).not.toContain(`${CONTENT_ORIGIN}/`);
    expect(csp.startsWith("default-src 'none'; style-src 'sha256-")).toBe(true);
  });

  it('a HEAD answers the same headers and no body', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const get = await r.get(token);
    const head = await r.get(token, 'document', 'HEAD');
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-security-policy']).toBe(get.headers['content-security-policy']);
  });
});

describe('wrapper: the bar', () => {
  it('wrapper: the bar names the page and the pin and says this is not ccrc', async () => {
    const r = rig();
    const committed = mint(r, committedInput());
    const draft = mint(r, draftInput());
    const c = textOf((await r.get(committed.token)).body);
    expect(c).toContain('This is not ccrc');
    expect(c).toContain('never type your ccrc passphrase here');
    expect(c).toContain('Runs its own code');
    // Closing the tab does not end the link (spec 7, A11): the hint says Revoke does, and never that closing does.
    expect(c).toContain('Close this tab when you are done; Revoke in ccrc ends the link.');
    expect(c).not.toMatch(/close this tab to end/i);
    expect(c).toContain(`Artifact · project-a · specs/x/page.html · at ${COMMIT.slice(0, 7)}`);
    expect(c).not.toContain(COMMIT.slice(0, 8));
    expect(c).not.toContain('draft');
    const d = textOf((await r.get(draft.token)).body);
    expect(d).toContain('This is not ccrc');
    expect(d).toContain('Artifact · project-a · specs/x/page.html · draft');
    expect(d).not.toContain(' at ');
    expect(d).not.toContain(COMMIT.slice(0, 7));
  });

  it('the document is a complete page: doctype, charset, viewport and title', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const res = await r.get(token);
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('<iframe');
    expect(body).toContain('<meta charset="utf-8">');
    expect(body).toMatch(/<meta name="viewport" content="[^"]+">/);
    expect(body).toMatch(/<title>[^<]+<\/title>/);
  });
});

describe('wrapper: the fence and the ended link', () => {
  it('wrapper: a non-document request is 403', async () => {
    const r = rig();
    const live = mint(r, committedInput());
    const before = r.store.list()[0]!.lastAt;
    r.advance(5 * MIN);
    const unknown = nextToken();
    // The fence reads no capability: not one look-up while any of these is refused (a look-up would also end a dead one).
    const lookups = vi.spyOn(r.store, 'lookup');
    const answers: { status: number; type: unknown; body: string }[] = [];
    for (const token of [live.token, unknown]) {
      for (const dest of [null, 'iframe', 'empty', 'script', 'DOCUMENT', 'document, iframe', '']) {
        const res = await r.get(token, dest);
        answers.push({ status: res.statusCode, type: res.headers['content-type'], body: res.body });
        expect(res.statusCode, `${token === live.token ? 'live' : 'unknown'} ${String(dest)}`).toBe(403);
        expect(res.headers['content-security-policy']).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size, 'every 403 is identical').toBe(1);
    expect(answers[0]).toEqual({ status: 403, type: 'text/plain; charset=utf-8', body: FORBIDDEN });
    // A HEAD is fenced the same way, with no body.
    const head = await r.get(live.token, null, 'HEAD');
    expect(head.statusCode).toBe(403);
    expect(head.body).toBe('');
    expect(lookups).not.toHaveBeenCalled();
    // A refused request reads no capability and so never moves its idle clock.
    expect(r.store.list()[0]!.lastAt).toBe(before);
  });

  it('wrapper: an ended link shows the fixed sentence', async () => {
    const r = rig();
    const live = mint(r, committedInput());
    const revoked = mint(r, committedInput());
    const idle = mint(r, committedInput());
    const ended = mint(r, committedInput({ sessionIdHash: 'e'.repeat(64) }));
    expect((await r.get(live.token)).statusCode).toBe(200);
    expect(r.store.revoke(revoked.id)).toBe(true);
    r.ended.add('e'.repeat(64));
    // The live one is touched past the idle hour of the third, which is never asked again until now.
    r.advance(ARTIFACT_IDLE_MS - MIN);
    expect((await r.get(live.token)).statusCode).toBe(200);
    r.advance(2 * MIN);
    const tokens: Record<string, string> = {
      unknown: nextToken(), malformed: 'not-a-token', short: 'A'.repeat(42), revoked: revoked.token, idle: idle.token,
      'session ended': ended.token,
    };
    const answers: Record<string, { status: number; headers: Record<string, unknown>; body: string }> = {};
    for (const [word, token] of Object.entries(tokens)) {
      const res = await r.get(token);
      const { date: _date, ...rest } = res.headers;
      answers[word] = { status: res.statusCode, headers: rest, body: res.body };
    }
    for (const [word, a] of Object.entries(answers)) {
      expect(a.status, word).toBe(404);
      expect(a.body, word).toBe(ARTIFACT_ENDED_BODY);
      expect(a.headers['content-type'], word).toBe('text/html; charset=utf-8');
      expect(a.headers['content-security-policy'], word).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      expect(a, word).toEqual(answers['unknown']);
    }
    // A HEAD of an ended link is the same 404, with no body.
    const head = await r.get(tokens['revoked']!, 'document', 'HEAD');
    expect(head.statusCode).toBe(404);
    expect(head.body).toBe('');
    // The page still works for the capability that was touched.
    expect((await r.get(live.token)).statusCode).toBe(200);
    // The sentence, exactly, in a page with no script and nothing it loads.
    expect(ENDED_SENTENCE).toBe('This artifact link has ended. Open it again from ccrc.');
    expect(ARTIFACT_ENDED_BODY).toContain(`<p>${ENDED_SENTENCE}</p>`);
    expect(textOf(ARTIFACT_ENDED_BODY).replace(/ccrc artifacts/, '').trim()).toBe(ENDED_SENTENCE);
    expect(ARTIFACT_ENDED_BODY.toLowerCase()).not.toMatch(/<script|<link|<img|<iframe|src=|href=|http/);
    expect(ARTIFACT_ENDED_BODY.startsWith('<!doctype html>')).toBe(true);
  });

  it('wrapper: a request touches the idle clock', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    r.advance(40 * MIN);
    expect((await r.get(token)).statusCode).toBe(200);
    r.advance(40 * MIN);
    expect((await r.get(token)).statusCode).toBe(200);
    r.advance(40 * MIN);
    expect((await r.get(token)).statusCode).toBe(200);
    // And an hour of silence ends it.
    r.advance(ARTIFACT_IDLE_MS + 1);
    const gone = await r.get(token);
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toBe(ARTIFACT_ENDED_BODY);
  });
});

describe('wrapper: nothing leaks and nothing is logged', () => {
  it('wrapper: logs no path', async () => {
    const r = rig();
    const { token } = mint(r, committedInput());
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    expect((await r.get(token)).statusCode).toBe(200);
    expect((await r.get(token, 'iframe')).statusCode).toBe(403);
    expect((await r.get(nextToken())).statusCode).toBe(404);
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
  });

  it('wrapper: no secret in any answer', async () => {
    const r = rig();
    const a = mint(r, committedInput());
    const b = mint(r, draftInput({ windows: true }));
    // This case makes its own answers (200s, a HEAD, a 403 and a 404), so it holds when it runs alone too; the answers of the
    // file's other cases, when they ran first, are read as well.
    const own = seen.length;
    await r.get(a.token);
    await r.get(b.token);
    await r.get(a.token, 'document', 'HEAD');
    await r.get(a.token, 'iframe');
    await r.get(nextToken());
    expect(seen.length - own).toBe(5);
    expect(seen.slice(own).filter((s) => s.status === 200).length, 'the answers read include wrapper documents').toBe(3);
    const sessionHash = createHash('sha256').update(SESSION).digest('hex');
    const tokenHashes = [a.token, b.token].map((t) => createHash('sha256').update(t).digest('hex'));
    for (const s of seen) {
      const text = `${JSON.stringify(s.headers)}\n${s.body}`;
      for (const secret of [SESSION, sessionHash, BOX_TOKEN, 'console.example.test', CONSOLE_ORIGIN, ...tokenHashes]) {
        expect(text, `an answer holds ${secret.slice(0, 12)}`).not.toContain(secret);
      }
      expect(text.toLowerCase()).not.toContain('set-cookie');
    }
  });
});

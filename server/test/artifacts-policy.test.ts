// X5 A3.2: the artifact content page's policy, the fetch fences, the cache rule, ranges and admission (L1, pure).
// Every expected string below is written out from the design (docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md,
// sections 4.3 and 5), never built from the source's own constants, so a drifted constant cannot make a wrong string pass.
import { describe, expect, it } from 'vitest';
import {
  CONTENT_HEADERS, admitLoad, admitQueued, artifactContentType, cacheControl, cacheKind, contentCsp, fetchFence, parseRange,
} from '../src/artifacts/policy.js';
import { ARTIFACT_MIME, artifactMime } from '../../shared/artifacts.js';

const ART = 'https://art.artifacts.invalid';
const CONTENT = 'https://content.artifacts.invalid';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const S = `${CONTENT}/c/${TOKEN}/`;
const CDN1 = 'https://cdn.example.test';
const CDN2 = 'https://fonts.example.test';

/** The spec's CSP for the given origin text `o` (empty for none; else the origins already joined) and windows flag. */
function specCsp(o: string, windows: boolean): string {
  const sp = o === '' ? '' : ` ${o}`;
  return [
    `default-src 'none'`,
    `script-src ${S} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:${sp}`,
    `style-src ${S} 'unsafe-inline' data:${sp}`,
    `img-src ${S} data: blob:${sp}`,
    `font-src ${S} data:${sp}`,
    `media-src ${S} data: blob:`,
    `connect-src ${S} data: blob:`,
    `worker-src ${S} blob:`,
    `frame-src ${S}`,
    `child-src ${S} blob:`,
    `manifest-src 'none'`,
    `object-src 'none'`,
    `base-uri ${S}`,
    `form-action 'none'`,
    `frame-ancestors ${ART} ${CONTENT}`,
    `sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock${windows ? ' allow-popups' : ''}`,
  ].join('; ');
}

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
  if (found === undefined) throw new Error(`no ${name} directive`);
  return found;
}

describe('artifact page policy (X5 A3.2)', () => {
  it('policy: CONTENT_HEADERS equals the spec', () => {
    expect(CONTENT_HEADERS).toEqual({
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-dns-prefetch-control': 'off',
      'x-robots-tag': 'noindex, nofollow',
      'accept-ranges': 'bytes',
      'permissions-policy':
        'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), display-capture=(), fullscreen=(self), clipboard-write=(self)',
      // D-9145 (the coordinator's ruling of 2026-11-27): a cache never stands in for the service-worker fence.
      vary: 'Sec-Fetch-Dest, Service-Worker',
    });
    expect(Object.isFrozen(CONTENT_HEADERS)).toBe(true);
    expect(Object.keys(CONTENT_HEADERS).some((k) => k.startsWith('access-control-'))).toBe(false);
  });

  it('policy: content responses vary by Sec-Fetch-Dest and Service-Worker (D-9145)', () => {
    // Written from the ruling: an entry stored for a script tag or a fetch never matches a worker's script request.
    expect(CONTENT_HEADERS['vary']).toBe('Sec-Fetch-Dest, Service-Worker');
    expect(CONTENT_HEADERS['vary']!.split(', ').sort()).toEqual(['Sec-Fetch-Dest', 'Service-Worker']);
  });

  it('policy: a script is never stored (D-9145)', () => {
    // Every JavaScript MIME type essence a browser accepts as a script (the MIME Sniffing standard's list), written here.
    const JS = [
      'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
      'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
      'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
      'text/x-ecmascript', 'text/x-javascript',
    ];
    for (const m of JS) {
      expect(cacheKind(m), m).toBe('script');
      expect(cacheKind(`${m.toUpperCase()}; charset=utf-8`), m).toBe('script');
    }
    // The table's own script answers (the classic and module extensions) are scripts, and are never stored.
    for (const name of ['a.js', 'a.mjs', 'A.JS']) {
      expect(cacheKind(artifactMime(name).mime), name).toBe('script');
      expect(cacheControl(cacheKind(artifactMime(name).mime), 7200), name).toBe('no-store');
    }
    // Every row of the table: a JavaScript type is a script, HTML is html, anything else keeps the bounded private form.
    // SVG is `html` too: a browser opens it as a script-running document (D-9149).
    const SCRIPTED_DOCUMENTS = ['text/html', 'image/svg+xml'];
    for (const [ext, mime] of Object.entries(ARTIFACT_MIME)) {
      const want = JS.includes(mime) ? 'script' : SCRIPTED_DOCUMENTS.includes(mime) ? 'html' : 'other';
      expect(cacheKind(mime), ext).toBe(want);
    }
    for (const m of ['application/wasm', 'model/gltf-binary', 'image/png', 'application/json', 'text/css', 'application/octet-stream']) {
      expect(cacheKind(m), m).toBe('other');
      expect(cacheControl(cacheKind(m), 7200), m).toBe('private, max-age=3600, immutable');
    }
    expect(cacheKind('text/html')).toBe('html');
    expect(cacheControl('script', 0)).toBe('no-store');
    expect(cacheControl('script', 90)).toBe('no-store');
  });

  it('policy: a document that can run script is never stored (D-9149)', () => {
    // The MIME Sniffing standard's HTML MIME type and XML MIME types, written here.
    const SCRIPTED = [
      'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'application/xslt+xml',
    ];
    for (const m of SCRIPTED) {
      for (const spelled of [m, `${m.toUpperCase()}; charset=utf-8`]) {
        expect(cacheKind(spelled), spelled).toBe('html');
        expect(cacheControl(cacheKind(spelled), 7200), spelled).toBe('no-store');
      }
    }
    for (const m of [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'model/gltf+json', 'application/json', 'text/plain; x=+xml',
    ]) {
      expect(cacheKind(m), m).toBe('other');
      expect(cacheControl(cacheKind(m), 7200), m).toBe('private, max-age=3600, immutable');
    }
    // End to end through the MIME table: an SVG file reaches no-store.
    for (const name of ['a.svg', 'A.SVG']) {
      expect(cacheControl(cacheKind(artifactMime(name).mime), 7200), name).toBe('no-store');
    }
  });

  describe('policy: contentCsp equals the spec text', () => {
    it('with no origins and no windows', () => {
      expect(contentCsp(CONTENT, ART, TOKEN, [], false)).toBe(specCsp('', false));
    });
    it('with two origins', () => {
      expect(contentCsp(CONTENT, ART, TOKEN, [CDN1, CDN2], false)).toBe(specCsp(`${CDN1} ${CDN2}`, false));
    });
    it('with windows, allow-popups ends the sandbox', () => {
      const csp = contentCsp(CONTENT, ART, TOKEN, [], true);
      expect(csp).toBe(specCsp('', true));
      expect(csp.endsWith(' allow-pointer-lock allow-popups')).toBe(true);
    });
    it('without windows, no allow-popups anywhere', () => {
      expect(contentCsp(CONTENT, ART, TOKEN, [CDN1], false)).not.toContain('allow-popups');
    });
    it('with two origins and windows', () => {
      expect(contentCsp(CONTENT, ART, TOKEN, [CDN1, CDN2], true)).toBe(specCsp(`${CDN1} ${CDN2}`, true));
    });
  });

  it('policy: origins never in connect-src', () => {
    const csp = contentCsp(CONTENT, ART, TOKEN, [CDN1, CDN2], true);
    for (const name of ['connect-src', 'media-src', 'worker-src', 'frame-src', 'child-src']) {
      const d = directive(csp, name);
      expect(d, name).not.toContain(CDN1);
      expect(d, name).not.toContain(CDN2);
    }
    for (const name of ['script-src', 'style-src', 'img-src', 'font-src']) {
      const d = directive(csp, name);
      expect(d, name).toContain(CDN1);
      expect(d, name).toContain(CDN2);
    }
  });

  it("policy: never 'self'", () => {
    expect(contentCsp(CONTENT, ART, TOKEN, [], false)).not.toContain("'self'");
    expect(contentCsp(CONTENT, ART, TOKEN, [CDN1, CDN2], true)).not.toContain("'self'");
    // The capability path is the source in every directive that names a source of the page's own.
    const csp = contentCsp(CONTENT, ART, TOKEN, [], false);
    for (const name of ['script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'connect-src', 'worker-src', 'frame-src', 'child-src', 'base-uri']) {
      expect(directive(csp, name), name).toContain(` ${S}`);
    }
  });

  describe('fetchFence', () => {
    const nav = (dest: string, site: string) => ({ dest, mode: 'navigate', site });
    const sub = (dest: string, site: string) => ({ dest, mode: 'no-cors', site });

    it('policy: the fence row a navigation as iframe is ok from any site', () => {
      for (const site of ['cross-site', 'same-site', 'same-origin']) {
        expect(fetchFence(nav('iframe', site), false), site).toBe('ok');
        expect(fetchFence(nav('iframe', site), true), site).toBe('ok');
      }
    });

    it('policy: the fence row a navigation as document needs windows', () => {
      expect(fetchFence(nav('document', 'cross-site'), false)).toBe('refused');
      expect(fetchFence(nav('document', 'same-origin'), false)).toBe('refused');
      expect(fetchFence(nav('document', 'cross-site'), true)).toBe('ok');
      expect(fetchFence(nav('document', 'same-origin'), true)).toBe('ok');
    });

    it('policy: the fence row serviceworker, embed and object are refused', () => {
      for (const dest of ['serviceworker', 'embed', 'object']) {
        for (const windows of [false, true]) {
          expect(fetchFence(sub(dest, 'same-origin'), windows), `${dest} subresource`).toBe('refused');
          expect(fetchFence(nav(dest, 'same-origin'), windows), `${dest} navigation`).toBe('refused');
          expect(fetchFence({ dest, mode: 'same-origin', site: 'same-origin' }, windows), `${dest} other mode`).toBe('refused');
        }
      }
    });

    it('policy: the fence row a Service-Worker header is refused', () => {
      expect(fetchFence({ ...sub('script', 'same-origin'), serviceWorker: 'script' }, false)).toBe('refused');
      expect(fetchFence({ ...sub('script', 'same-origin'), serviceWorker: '' }, false)).toBe('refused');
      expect(fetchFence({ ...nav('iframe', 'same-origin'), serviceWorker: 'script' }, true)).toBe('refused');
      expect(fetchFence({ ...sub('script', 'same-origin') }, false)).toBe('ok');
    });

    it('policy: the fence row a non-navigation same-origin is ok whatever its dest', () => {
      for (const dest of ['image', 'script', 'worker', 'style', 'font', 'empty', 'iframe', 'document', 'video', 'audio', 'sharedworker']) {
        expect(fetchFence(sub(dest, 'same-origin'), false), dest).toBe('ok');
        expect(fetchFence({ dest, mode: 'cors', site: 'same-origin' }, true), dest).toBe('ok');
      }
    });

    it('policy: the fence row a non-navigation from another site is refused', () => {
      for (const site of ['cross-site', 'same-site', 'none']) {
        for (const dest of ['image', 'script', 'worker', 'style', 'font', 'empty', 'iframe']) {
          expect(fetchFence(sub(dest, site), false), `${dest} ${site}`).toBe('refused');
          expect(fetchFence({ dest, mode: 'cors', site }, true), `${dest} ${site}`).toBe('refused');
        }
      }
    });

    it('policy: the fence row a navigation of any other dest is refused', () => {
      for (const dest of ['image', 'script', 'frame', 'fencedframe', 'worker']) {
        expect(fetchFence(nav(dest, 'same-origin'), true), dest).toBe('refused');
      }
    });

    it('policy: the fence row a missing header is refused', () => {
      const full = { dest: 'image', mode: 'no-cors', site: 'same-origin' };
      expect(fetchFence(full, false)).toBe('ok');
      for (const key of ['dest', 'mode', 'site'] as const) {
        const missing: Record<string, string | undefined> = { ...full };
        delete missing[key];
        expect(fetchFence(missing, true), `${key} missing`).toBe('refused');
        expect(fetchFence({ ...full, [key]: undefined }, true), `${key} undefined`).toBe('refused');
        expect(fetchFence({ ...full, [key]: '' }, true), `${key} empty`).toBe('refused');
      }
      expect(fetchFence({}, true)).toBe('refused');
    });
  });

  it('policy: a download passes', () => {
    const dl = (site: string) => ({ dest: 'empty', mode: 'navigate', site });
    expect(fetchFence(dl('same-origin'), false)).toBe('ok');
    expect(fetchFence(dl('same-origin'), true)).toBe('ok');
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(fetchFence(dl(site), false), site).toBe('refused');
      expect(fetchFence(dl(site), true), site).toBe('refused');
    }
  });

  it("policy: cacheControl('html') is no-store", () => {
    expect(cacheControl('html', 0)).toBe('no-store');
    expect(cacheControl('html', 90)).toBe('no-store');
    expect(cacheControl('html', 7200)).toBe('no-store');
  });

  it('policy: cacheControl other is private, immutable and bounded', () => {
    expect(cacheControl('other', 7200)).toBe('private, max-age=3600, immutable');
    expect(cacheControl('other', 3600)).toBe('private, max-age=3600, immutable');
    expect(cacheControl('other', 90)).toBe('private, max-age=90, immutable');
    expect(cacheControl('other', 0)).toBe('private, max-age=0, immutable');
    expect(cacheControl('other', -5)).toBe('private, max-age=0, immutable');
    expect(cacheControl('other', 90.9)).toBe('private, max-age=90, immutable');
    // Not a number (a missing expiry): 0, never `max-age=NaN`. Infinity is no number of seconds either.
    expect(cacheControl('other', Number.NaN)).toBe('private, max-age=0, immutable');
    expect(cacheControl('other', Number.POSITIVE_INFINITY)).toBe('private, max-age=0, immutable');
  });

  describe('parseRange', () => {
    it('gives one range for the three forms', () => {
      expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'one', start: 0, end: 9 });
      expect(parseRange('bytes=5-', 100)).toEqual({ kind: 'one', start: 5, end: 99 });
      expect(parseRange('bytes=-4', 100)).toEqual({ kind: 'one', start: 96, end: 99 });
    });
    it('clips an end past the size and a suffix longer than the file', () => {
      expect(parseRange('bytes=90-200', 100)).toEqual({ kind: 'one', start: 90, end: 99 });
      expect(parseRange('bytes=-200', 100)).toEqual({ kind: 'one', start: 0, end: 99 });
      expect(parseRange('bytes=99-99', 100)).toEqual({ kind: 'one', start: 99, end: 99 });
    });
    it('is unsatisfiable for several ranges, a start at or past the size, a zero suffix and an empty file', () => {
      expect(parseRange('bytes=0-1,4-5', 100)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=100-120', 100)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=250-300', 100)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=0-9', 0)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
      expect(parseRange('bytes=-5', 0)).toEqual({ kind: 'unsatisfiable' });
    });
    it('is whole for no header and for a header it cannot parse', () => {
      expect(parseRange(undefined, 100)).toEqual({ kind: 'whole' });
      expect(parseRange('items=0-1', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=x-y', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=5-1', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=0-1 ', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=-', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=0-9999999999999999', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=1234567890123456-', 100)).toEqual({ kind: 'whole' });
      expect(parseRange('bytes=-1234567890123456', 100)).toEqual({ kind: 'whole' });
    });
  });

  it('artifactContentType: text types carry their charset', () => {
    for (const mime of ['text/html', 'text/javascript', 'text/css', 'application/json', 'image/svg+xml']) {
      expect(artifactContentType(mime)).toBe(`${mime}; charset=utf-8`);
    }
    for (const mime of ['application/wasm', 'image/png', 'model/gltf-binary', 'application/octet-stream']) {
      expect(artifactContentType(mime)).toBe(mime);
    }
  });

  describe('admission', () => {
    it('admitLoad runs below both bounds with nothing queued', () => {
      expect(admitLoad({ inflight: 0, queued: 0 }, 0)).toBe('run');
      expect(admitLoad({ inflight: 3, queued: 0 }, 15)).toBe('run');
    });
    it('admitLoad waits at the capability bound or the box bound', () => {
      expect(admitLoad({ inflight: 4, queued: 0 }, 0)).toBe('wait');
      expect(admitLoad({ inflight: 0, queued: 0 }, 16)).toBe('wait');
      expect(admitLoad({ inflight: 4, queued: 62 }, 16)).toBe('wait');
      expect(admitLoad({ inflight: 4, queued: 63 }, 16)).toBe('wait');
    });
    it('admitLoad is full at 64 queued', () => {
      expect(admitLoad({ inflight: 4, queued: 64 }, 0)).toBe('full');
      expect(admitLoad({ inflight: 0, queued: 64 }, 16)).toBe('full');
    });
    it('admitLoad queues behind a waiting request even with room to run', () => {
      expect(admitLoad({ inflight: 0, queued: 1 }, 0)).toBe('wait');
      expect(admitLoad({ inflight: 3, queued: 1 }, 15)).toBe('wait');
      expect(admitLoad({ inflight: 0, queued: 64 }, 0)).toBe('full');
    });
    it('admitQueued admits at the head only below both bounds', () => {
      expect(admitQueued({ inflight: 3 }, 15)).toBe(true);
      expect(admitQueued({ inflight: 4 }, 15)).toBe(false);
      expect(admitQueued({ inflight: 3 }, 16)).toBe(false);
      expect(admitQueued({ inflight: 0 }, 0)).toBe(true);
    });
  });
});

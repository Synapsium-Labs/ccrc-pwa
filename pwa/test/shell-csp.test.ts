import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The shell's one Content-Security-Policy meta (source half of M8.13; the
// built half lives in the built-output test). It carries `frame-src 'none'`
// and nothing else: no script-src, so the inline pre-paint scripts keep
// running. The meta precedes every <style> and <script>.

const html = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const cspMetas = [...doc.querySelectorAll('meta')].filter(
  (m) => (m.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy',
);

describe('M8.13: the shell carries exactly one CSP meta, frame-src none', () => {
  it('index.html holds exactly one Content-Security-Policy meta', () => {
    expect(cspMetas).toHaveLength(1);
  });

  it('its policy re-tokenised is exactly frame-src none', () => {
    const content = cspMetas[0]?.getAttribute('content') ?? '';
    const directives = content
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d) => d.split(/[\t\n\f\r ]+/));
    expect(directives).toEqual([['frame-src', "'none'"]]);
  });

  it('it names no script-src, default-src, style-src or font-src', () => {
    expect(cspMetas).toHaveLength(1);
    const content = cspMetas[0]?.getAttribute('content') ?? '';
    const names = content
      .split(';')
      .map((d) => d.trim().split(/[\t\n\f\r ]+/)[0]?.toLowerCase())
      .filter((n): n is string => !!n);
    for (const banned of ['script-src', 'default-src', 'style-src', 'font-src']) {
      expect(names).not.toContain(banned);
    }
  });

  it('it precedes the first script and the first style', () => {
    const kids = [...doc.head.children];
    const at = kids.findIndex((e) => e === cspMetas[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    const script = kids.findIndex((e) => e.tagName === 'SCRIPT');
    const style = kids.findIndex((e) => e.tagName === 'STYLE');
    if (script >= 0) expect(at).toBeLessThan(script);
    if (style >= 0) expect(at).toBeLessThan(style);
  });
});

// The build-time knob that keeps ccrc's service worker off other people's
// paths — see `pwa/src/lib/sw-denylist.ts` for why it is a knob and not a list.
//
// This is tested at all because the failure mode is invisible in development:
// the service worker is not installed, so a co-tenant path works perfectly
// until the bundle ships.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swDenylist } from '../src/lib/sw-denylist.js';

/** Does this denylist claim the given navigation? */
const denies = (list: RegExp[], url: string): boolean => list.some((re) => re.test(url));

describe('swDenylist', () => {
  it('denies ccrc\'s own server-state prefixes with no configuration at all', () => {
    for (const extra of [undefined, '', '   ', ',', ' , ']) {
      const list = swDenylist(extra);
      expect(denies(list, '/api/fleet'), `extra=${JSON.stringify(extra)}`).toBe(true);
      expect(denies(list, '/ws/fleet'), `extra=${JSON.stringify(extra)}`).toBe(true);
      expect(list, 'an empty knob must add nothing').toHaveLength(2);
    }
  });

  it('still answers ccrc\'s own routes with the shell', () => {
    const list = swDenylist(undefined);
    for (const own of ['/', '/fleet-view', '/settings', '/session/claude-orchard-api']) {
      expect(denies(list, own), `${own} is ccrc's own route`).toBe(false);
    }
  });

  it('denies a configured co-tenant path and everything under it', () => {
    const list = swDenylist('/docs,/fleet');
    for (const u of ['/docs', '/docs/', '/docs/ccrc/specs/a.md', '/fleet', '/fleet/x']) {
      expect(denies(list, u), u).toBe(true);
    }
  });

  it('does NOT deny a sibling that merely shares a prefix', () => {
    // `/docsearch` is not under `/docs`. A naive `startsWith` would hand it to
    // the network and the route would 404 from a server that has never heard
    // of it — a ccrc route silently stolen by a co-tenant's name.
    const list = swDenylist('/docs');
    expect(denies(list, '/docsearch')).toBe(false);
    expect(denies(list, '/docs-archive')).toBe(false);
  });

  it('accepts what a person actually types', () => {
    // No leading slash, trailing slash, spaces around the commas. A knob that
    // silently does nothing for `docs` is worse than no knob, because the
    // operator sees a config line and believes it.
    for (const spelling of ['/docs', 'docs', '/docs/', ' docs , ', '/docs,']) {
      expect(denies(swDenylist(spelling), '/docs/x'), JSON.stringify(spelling)).toBe(true);
    }
  });

  it('escapes regex metacharacters rather than interpreting them', () => {
    // `.` in a path is a literal dot. Left unescaped it matches any character,
    // so `/v1.x` would also claim `/v1Zx`.
    const list = swDenylist('/v1.x');
    expect(denies(list, '/v1.x/a')).toBe(true);
    expect(denies(list, '/v1Zx/a'), 'an unescaped dot matched a sibling').toBe(false);
  });
});

describe('vite.config.ts consumes the knob rather than restating the list', () => {
  const config = (): string => readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vite.config.ts'), 'utf8');

  it('builds navigateFallbackDenylist from swDenylist(CCRC_SW_DENYLIST)', () => {
    const s = config();
    expect(s).toMatch(/navigateFallbackDenylist:\s*swDenylist\(/);
    expect(s).toContain('CCRC_SW_DENYLIST');
  });

  it('hardcodes no co-tenant path of its own', () => {
    // The whole point: one operator's reverse-proxy layout must not be
    // compiled into everybody's service worker.
    const s = config();
    expect(s, 'a co-tenant path is back in the build config')
      .not.toMatch(/navigateFallbackDenylist:.*\/docs/);
    expect(s).not.toMatch(/\^\\\/docs/);
    expect(s).not.toMatch(/\^\\\/fleet/);
  });
});

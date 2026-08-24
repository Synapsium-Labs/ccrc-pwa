import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swDenylist } from '../src/lib/sw-denylist';

// ── The service worker's navigation denylist is the BUILDER's knob (S6) ────
//
// The built-in list is ccrc's own truth only: /api/ and /ws/ must never be
// answered by the SPA shell. Co-tenant paths (a box may park other services
// at the same web root) are NOT ccrc's to know — they arrive at build time
// via CCRC_SW_DENYLIST, and a release-tarball install that sets nothing gets
// the clean default. swDenylist is the single seam vite.config consumes, so
// this suite pins both halves: the default stays two entries, and the knob
// appends prefix-anchored patterns rather than replacing ccrc's own.
//
// Tested at all because the failure mode is invisible in development: the
// service worker is not installed there, so a co-tenant path works perfectly
// until the bundle ships.

/** Does this denylist claim the given navigation? */
const denies = (list: RegExp[], url: string): boolean => list.some((re) => re.test(url));

describe('swDenylist', () => {
  it('default: ccrc’s own truth only — /api/ and /ws/', () => {
    expect(swDenylist(undefined).map(String)).toEqual([/^\/api\//, /^\/ws\//].map(String));
  });

  it('every empty-shaped knob is the same as unset', () => {
    // '' and undefined, but also whitespace, bare commas, and the root path
    // itself — '/' is the shell's own front door, never a co-tenant's.
    for (const extra of ['', '   ', ',', ' , ', '/', ' / ,']) {
      expect(swDenylist(extra).map(String), `extra=${JSON.stringify(extra)}`).toEqual(
        swDenylist(undefined).map(String),
      );
    }
  });

  it('denies ccrc’s own server-state prefixes with no configuration at all', () => {
    const list = swDenylist(undefined);
    expect(denies(list, '/api/fleet')).toBe(true);
    expect(denies(list, '/ws/fleet')).toBe(true);
  });

  it('still answers ccrc’s own routes with the shell', () => {
    const list = swDenylist(undefined);
    for (const own of ['/', '/fleet-view', '/settings', '/session/claude-b']) {
      expect(denies(list, own), `${own} is ccrc's own route`).toBe(false);
    }
  });

  it('appends co-tenant prefixes after the built-ins', () => {
    expect(swDenylist('/docs,/fleet').map(String)).toEqual(
      [/^\/api\//, /^\/ws\//, /^\/docs(\/|$)/, /^\/fleet(\/|$)/].map(String),
    );
  });

  it('an appended prefix matches the path and its subtree, never a sibling', () => {
    const list = swDenylist('/docs,/fleet');
    for (const under of ['/docs', '/docs/', '/docs/guide/intro', '/fleet', '/fleet/x']) {
      expect(denies(list, under), under).toBe(true);
    }
    // /docsy is a DIFFERENT route — a prefix knob that swallowed it would
    // take unrelated SPA routes dark, which is why (\/|$) anchors the end.
    // A naive startsWith would hand these to the network and the route would
    // 404 from a server that has never heard of them.
    for (const sibling of ['/docsy', '/docs-archive', '/fleet-view']) {
      expect(denies(list, sibling), `${sibling} merely shares a prefix`).toBe(false);
    }
  });

  it('tolerates spaces and empty segments — an env file is typed by hand', () => {
    expect(swDenylist(' /docs , ,/fleet ,').map(String)).toEqual(
      swDenylist('/docs,/fleet').map(String),
    );
  });

  it('accepts what a person actually types — slashes are normalized, not required', () => {
    // No leading slash, a trailing or doubled one. A knob that silently does
    // nothing for `docs` is worse than no knob, because the operator sees a
    // config line and believes it.
    for (const spelling of ['/docs', 'docs', '/docs/', '//docs', ' docs , ', '/docs,']) {
      expect(denies(swDenylist(spelling), '/docs/x'), JSON.stringify(spelling)).toBe(true);
    }
  });

  it('a path is a literal: regex metacharacters do not widen the match', () => {
    const list = swDenylist('/v1.0');
    expect(denies(list, '/v1.0')).toBe(true);
    expect(denies(list, '/v1.0/a')).toBe(true);
    // Left unescaped, `.` matches any character — and a sibling is claimed.
    expect(denies(list, '/v1x0'), 'an unescaped dot matched a sibling').toBe(false);
  });
});

describe('vite.config consumes the knob rather than restating the list', () => {
  const config = (): string =>
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vite.config.ts'),
      'utf8',
    );

  it('CONSUMES it at navigateFallbackDenylist — wired, not merely defined', () => {
    // Everything above exercises the helper in isolation, so all of it stays
    // green if vite.config quietly reverts to a hardcoded array — co-tenant
    // facts back in the tree, the knob dead, and topology-clean silent (bare
    // /docs and /fleet tokens are not in its forbidden classes). Same
    // wired-in-not-merely-defined pin the deploy lane carries in
    // server/test/deploy-env-guard.test.ts, at this side's consumption site.
    expect(config()).toContain("navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST'])");
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

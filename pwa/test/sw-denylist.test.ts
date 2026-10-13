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
    expect(swDenylist('/wiki,/fleet').map(String)).toEqual(
      [/^\/api\//, /^\/ws\//, /^\/wiki(\/|$)/, /^\/fleet(\/|$)/].map(String),
    );
  });

  it('an appended prefix matches the path and its subtree, never a sibling', () => {
    const list = swDenylist('/wiki,/fleet');
    for (const under of ['/wiki', '/wiki/', '/wiki/guide/intro', '/fleet', '/fleet/x']) {
      expect(denies(list, under), under).toBe(true);
    }
    // /wikis is a DIFFERENT route — a prefix knob that swallowed it would
    // take unrelated SPA routes dark, which is why (\/|$) anchors the end.
    // A naive startsWith would hand these to the network and the route would
    // 404 from a server that has never heard of them.
    for (const sibling of ['/wikis', '/wiki-archive', '/fleet-view']) {
      expect(denies(list, sibling), `${sibling} merely shares a prefix`).toBe(false);
    }
  });

  it('tolerates spaces and empty segments — an env file is typed by hand', () => {
    expect(swDenylist(' /wiki , ,/fleet ,').map(String)).toEqual(
      swDenylist('/wiki,/fleet').map(String),
    );
  });

  it('accepts what a person actually types — slashes are normalized, not required', () => {
    // No leading slash, a trailing or doubled one. A knob that silently does
    // nothing for `wiki` is worse than no knob, because the operator sees a
    // config line and believes it.
    for (const spelling of ['/wiki', 'wiki', '/wiki/', '//wiki', ' wiki , ', '/wiki,']) {
      expect(denies(swDenylist(spelling), '/wiki/x'), JSON.stringify(spelling)).toBe(true);
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

// ── M7.2: an entry covering ccrc's own Docs pages fails the build (spec 7.3) ──
//
// `/docs/*` is ccrc's own: the server's not-found handler and the worker's
// navigateFallback both hand those pages the app shell. A knob entry equal to
// the Docs prefix, or under it, would send every Docs navigation past the
// shell, so swDenylist THROWS; vite.config calls it at config load, so the
// build stops before anything ships. The verdict is on the NORMALISED entry,
// the same trim and slash rules every other knob path gets, and the message
// names that normalised form.

/** Spec 7.3's sentence, with the normalised entry in place of `<p>`. */
const refusal = (p: string): string =>
  `CCRC_SW_DENYLIST entry ${p} covers /docs, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again.`;

/** What `swDenylist(extra)` threw; `{ threw: false }` when it returned a list. */
function attempt(extra: string): { threw: false } | { threw: true; error: unknown } {
  try {
    swDenylist(extra);
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}

describe('M7.2: the build refuses an entry covering /docs; the default never denies it', () => {
  it('throws, naming the normalised entry and CCRC_SW_DENYLIST, for every spelling of the Docs prefix', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['/docs', '/docs'],
      ['docs', '/docs'],
      [' /docs/ ', '/docs'],
      ['//docs', '/docs'],
      ['/docs/x', '/docs/x'],
      ['/wiki,/docs', '/docs'],
      ['/wiki, docs/ ,/fleet', '/docs'],
    ];
    for (const [extra, normalised] of cases) {
      const got = attempt(extra);
      expect(got.threw, JSON.stringify(extra)).toBe(true);
      if (!got.threw) continue;
      expect(got.error, JSON.stringify(extra)).toBeInstanceOf(Error);
      const message = (got.error as Error).message;
      expect(message, JSON.stringify(extra)).toBe(refusal(normalised));
      expect(message).toContain('CCRC_SW_DENYLIST');
      expect(message).toContain(`entry ${normalised} covers`);
    }
  });

  it('refuses only the Docs prefix: a sibling that merely starts the same way builds', () => {
    for (const sibling of ['/docsy', '/docs-archive', 'docsearch/']) {
      expect(attempt(sibling).threw, `${sibling} is not under /docs`).toBe(false);
    }
    // And it is still a co-tenant: the knob denies it like any other path.
    const list = swDenylist('/docsy,/docs-archive');
    expect(denies(list, '/docsy/a')).toBe(true);
    expect(denies(list, '/docs-archive')).toBe(true);
    expect(denies(list, '/docs/p/specs/a.md'), 'a sibling entry claimed a Docs page').toBe(false);
  });

  // Review 408's F9: a path that ENDS in /docs, or holds it, is another co-tenant's (a wiki's own docs section), and
  // builds; only an entry that starts with the Docs prefix covers ccrc's Docs pages.
  it('refuses only the Docs prefix: an entry ending in or holding /docs builds', () => {
    for (const elsewhere of ['/wiki/docs', 'wiki/docs/', '/wiki/docs/a', '/a/docs/b']) {
      expect(attempt(elsewhere).threw, `${elsewhere} is not under /docs`).toBe(false);
    }
    const list = swDenylist('/wiki/docs');
    expect(denies(list, '/wiki/docs/a')).toBe(true);
    expect(denies(list, '/docs/p/specs/a.md'), 'a /wiki/docs entry claimed a Docs page').toBe(false);
  });

  it('the default does not deny a Docs page, and does deny the Docs API', () => {
    const list = swDenylist(undefined);
    for (const page of ['/docs', '/docs/', '/docs/p', '/docs/p/specs/a.md']) {
      expect(denies(list, page), `${page} is ccrc's own Docs page`).toBe(false);
    }
    expect(denies(list, '/api/docs/p/tree')).toBe(true);
  });

  it('/docs is never on the worker\'s own list (C5): every list leads with exactly the two built-ins', () => {
    for (const extra of [undefined, '', '/wiki', '/wiki,/fleet']) {
      const list = swDenylist(extra);
      expect(list.slice(0, 2).map(String), JSON.stringify(extra)).toEqual([/^\/api\//, /^\/ws\//].map(String));
      expect(denies(list, '/docs/p/specs/a.md'), JSON.stringify(extra)).toBe(false);
    }
  });

  it('reads the prefix from shared/docs.ts rather than spelling it', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'sw-denylist.ts'),
      'utf8',
    );
    expect(src).toContain("import { DOCS_PAGE_PREFIX } from '../../../shared/docs';");
    expect(src, 'a quoted /docs literal: the prefix has one home').not.toMatch(/['"]\/docs/);
  });
});

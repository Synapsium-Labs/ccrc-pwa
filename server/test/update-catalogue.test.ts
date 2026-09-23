// The release-catalogue poller (design 2026-09-20 §7; plan W2 Task 10).
//
// A REAL loopback HTTP server stands in for GitHub, never
// `vi.stubGlobal('fetch')`: the pins below are about a conditional GET — the
// second poll must SEND `If-None-Match` and a 304 must write nothing — and a
// stubbed global cannot read the request's headers to decide whether to answer
// 304. Same fixture shape as `ccrc-api.test.ts:52-65` (`listen(0,
// '127.0.0.1')`, the port read back off `server.address()`).
//
// The store behind the poller is the REAL `CoordStore` on a fixture
// `coord.db` (Task 4's `applyReleaseListing`), wrapped in a recorder so a
// case can say both "the store was not called" and "the rows are what they
// were". Owner/repo are invented; no TS root may spell the real org
// (`single-definition.test.ts`, "the four TS roots never name the org").
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type ListingCoverage, type ReleaseListingRow } from '../src/coord/store.js';
import type { ReleaseSourceRead } from '../src/config.js';
import {
  CATALOGUE_BODY_MAX_BYTES, DOWNLOAD_URL_MAX, NOTES_CAP_BYTES, NOTES_MARKER, RELEASES_PER_PAGE,
  apiBaseProblem, capNotes, createCataloguePoller, parseReleaseListing,
  type CatalogueStore, type CataloguePoller,
} from '../src/update/catalogue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  RELEASE_TAG_COMPONENT_MAX_DIGITS, resolveNodeIntent, type EligibilityRow, type ResolveInput,
} from '../src/update/resolve.js';
import { BASE_URL_OK } from '../../shared/base-url.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SOURCE: ReleaseSourceRead = { ok: true, owner: 'fixture-owner', repo: 'fixture-repo', from: 'env' };

/** One element of GitHub's `GET /repos/{o}/{r}/releases` answer, in the
 *  documented shape, carrying the three artifacts `deploy/release-main.sh`
 *  publishes (`:128`: `ccrc-$tag.tar.gz`, `SHA256SUMS`,
 *  `ccrc-$tag.tar.gz.sigstore.json`). */
function rel(tag: string, publishedAt: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const dl = (name: string) => ({ name, browser_download_url: `https://example.invalid/releases/download/${tag}/${name}` });
  return {
    tag_name: tag, name: tag, draft: false, prerelease: false, published_at: publishedAt,
    target_commitish: SHA, body: `notes for ${tag}`,
    assets: [dl(`ccrc-${tag}.tar.gz`), dl('SHA256SUMS'), dl(`ccrc-${tag}.tar.gz.sigstore.json`)],
    ...over,
  };
}

/** `n` well-formed releases v0.0.1..v0.0.n, each published a minute after the last. */
function page(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) =>
    rel(`v0.0.${i + 1}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()));
}

describe('parseReleaseListing — one GitHub element, one row (design §7)', () => {
  it('maps the documented fields onto the catalogue columns', () => {
    const p = parseReleaseListing([rel('v0.0.9', '2026-09-20T10:00:00Z')]);
    expect(p).not.toBeNull();
    expect(p!.skipped).toBe(0);
    expect(p!.rows).toEqual([{
      tag: 'v0.0.9', channel: 'stable', publishedAt: Date.parse('2026-09-20T10:00:00Z'), commitSha: SHA,
      tarballUrl: 'https://example.invalid/releases/download/v0.0.9/ccrc-v0.0.9.tar.gz', bundleListed: true,
      notes: 'notes for v0.0.9', draft: false,
    }]);
  });

  it('prerelease: true is the dev channel; a draft is carried for the store to mark', () => {
    const p = parseReleaseListing([
      rel('v0.0.10', '2026-09-21T10:00:00Z', { prerelease: true }),
      rel('v0.0.11', '2026-09-22T10:00:00Z', { draft: true }),
    ]);
    expect(p!.rows.map((r) => [r.tag, r.channel, r.draft])).toEqual([
      ['v0.0.10', 'dev', false],
      ['v0.0.11', 'stable', true],
    ]);
  });

  it('bundleListed is the presence of the .sigstore.json asset — a filename, never a verification', () => {
    const noBundle = rel('v0.0.9', '2026-09-20T10:00:00Z', {
      assets: [{ name: 'ccrc-v0.0.9.tar.gz', browser_download_url: 'https://example.invalid/t.tar.gz' }],
    });
    // A bundle for ANOTHER tag does not list this one's.
    const otherBundle = rel('v0.0.8', '2026-09-19T10:00:00Z', {
      assets: [
        { name: 'ccrc-v0.0.8.tar.gz', browser_download_url: 'https://example.invalid/t8.tar.gz' },
        { name: 'ccrc-v0.0.7.tar.gz.sigstore.json', browser_download_url: 'https://example.invalid/b7' },
      ],
    });
    expect(parseReleaseListing([noBundle, otherBundle])!.rows.map((r) => r.bundleListed)).toEqual([false, false]);
  });

  it('commitSha is target_commitish only when it is 40 lowercase hex', () => {
    const rows = parseReleaseListing([
      rel('v0.0.1', '2026-09-01T00:00:00Z', { target_commitish: 'main' }),
      rel('v0.0.2', '2026-09-02T00:00:00Z', { target_commitish: SHA.toUpperCase() }),
      rel('v0.0.3', '2026-09-03T00:00:00Z', { target_commitish: 42 }),
      rel('v0.0.4', '2026-09-04T00:00:00Z'),
    ])!.rows;
    expect(rows.map((r) => r.commitSha)).toEqual([null, null, null, SHA]);
  });

  it('a malformed element is SKIPPED and counted, never thrown', () => {
    const good = rel('v0.0.9', '2026-09-20T10:00:00Z');
    const p = parseReleaseListing([
      null, 'v0.0.1', 7, [], {},
      rel('v0.0', '2026-09-20T10:00:00Z'),                        // not the tag shape
      rel('0.0.2', '2026-09-20T10:00:00Z'),                       // no v
      rel('v0.0.3', '2026-09-20T10:00:00Z', { prerelease: 'yes' }), // never defaulted to stable
      rel('v0.0.4', 'not a date'),
      rel('v0.0.5', '2026-09-20T10:00:00Z', { assets: 'none' }),
      // F10 (fix round 1, D-3216): neither of these two skips the ELEMENT any
      // more — the release stays listed with tarballUrl withheld. See the
      // `safeDownloadUrl` describe below for the dedicated pins.
      rel('v0.0.6', '2026-09-20T10:00:00Z', { assets: [] }),       // no tarball asset
      rel('v0.0.7', '2026-09-20T10:00:00Z', {
        assets: [{ name: 'ccrc-v0.0.7.tar.gz', browser_download_url: 'javascript:alert(1)' }],
      }),
      good,
    ]);
    expect(p!.rows.map((r) => [r.tag, r.tarballUrl])).toEqual([
      ['v0.0.6', null],
      ['v0.0.7', null],
      ['v0.0.9', 'https://example.invalid/releases/download/v0.0.9/ccrc-v0.0.9.tar.gz'],
    ]);
    expect(p!.skipped).toBe(10);
  });

  it('a body that is not an array is null — the poll reads it as malformed', () => {
    for (const body of [null, {}, 'releases', 3, { releases: [] }]) {
      expect(parseReleaseListing(body), JSON.stringify(body)).toBeNull();
    }
  });

  // D-3185: the store may mark "absent now" as yanked only across
  // the whole catalogue when the listing IS the whole catalogue. The page is
  // full at RELEASES_PER_PAGE elements, and that is a fact about the RAW
  // array: a malformed element skipped from a full page must not make the
  // page look complete, or the 31st release would be yanked on that poll.
  it('coverage comes from the RAW element count, not the parsed rows', () => {
    expect(RELEASES_PER_PAGE).toBe(30);
    expect(parseReleaseListing(page(29))!.coverage).toBe('complete');
    expect(parseReleaseListing(page(30))!.coverage).toBe('newest-page');
    const fullWithOneBad = [...page(29), { tag_name: 'garbage' }];
    const p = parseReleaseListing(fullWithOneBad)!;
    expect(p.rows).toHaveLength(29);
    expect(p.skipped).toBe(1);
    expect(p.coverage).toBe('newest-page');
    expect(parseReleaseListing([])!.coverage).toBe('complete');
  });

  // D-3209 (fix round 1, finding 4): the parser and the store must not
  // disagree on what a whole listing looks like — a pre-epoch element and a
  // duplicate tag are both things the store would otherwise refuse whole.
  it('D-3209: an element published before the epoch is skipped', () => {
    const p = parseReleaseListing([
      rel('v0.0.1', '1969-12-31T23:59:59Z'),
      rel('v0.0.2', '2026-09-20T10:00:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual(['v0.0.2']);
    expect(p!.skipped).toBe(1);
  });

  it('D-3209: a duplicate tag keeps the FIRST occurrence and skips the rest', () => {
    const first = rel('v0.0.1', '2026-09-02T00:00:00Z');
    const second = rel('v0.0.1', '2026-09-01T00:00:00Z', {
      assets: [{ name: 'ccrc-v0.0.1.tar.gz', browser_download_url: 'https://example.invalid/other.tar.gz' }],
    });
    const p = parseReleaseListing([first, second, rel('v0.0.2', '2026-09-03T00:00:00Z')]);
    expect(p!.rows.map((r) => [r.tag, r.tarballUrl])).toEqual([
      ['v0.0.1', 'https://example.invalid/releases/download/v0.0.1/ccrc-v0.0.1.tar.gz'],
      ['v0.0.2', 'https://example.invalid/releases/download/v0.0.2/ccrc-v0.0.2.tar.gz'],
    ]);
    expect(p!.skipped).toBe(1);
  });
});

describe('safeDownloadUrl / F10 (fix round 1, D-3216) — a bad download URL withholds the field, never the release', () => {
  const withUrl = (url: unknown) => rel('v0.0.9', '2026-09-20T10:00:00Z', {
    assets: [{ name: 'ccrc-v0.0.9.tar.gz', browser_download_url: url }],
  });

  it('a plain http URL is refused: NULL, release still listed', () => {
    const p = parseReleaseListing([withUrl('http://example.invalid/ccrc-v0.0.9.tar.gz')]);
    expect(p!.rows).toEqual([expect.objectContaining({ tag: 'v0.0.9', tarballUrl: null })]);
    expect(p!.skipped).toBe(0);
  });

  it('a C0 control character in the URL is refused: NULL', () => {
    const p = parseReleaseListing([withUrl('https://example.invalid/ccrc\tv0.0.9.tar.gz')]);
    expect(p!.rows[0]!.tarballUrl).toBeNull();
  });

  it('a non-ASCII byte in the URL is refused: NULL', () => {
    const p = parseReleaseListing([withUrl('https://example.invalid/ccrc-v0.0.9-café.tar.gz')]);
    expect(p!.rows[0]!.tarballUrl).toBeNull();
  });

  it('userinfo in the URL is refused: NULL', () => {
    const p = parseReleaseListing([withUrl('https://user:pw@example.invalid/ccrc-v0.0.9.tar.gz')]);
    expect(p!.rows[0]!.tarballUrl).toBeNull();
  });

  it('a good https URL is kept', () => {
    const p = parseReleaseListing([withUrl('https://example.invalid/ccrc-v0.0.9.tar.gz')]);
    expect(p!.rows[0]!.tarballUrl).toBe('https://example.invalid/ccrc-v0.0.9.tar.gz');
  });

  // Fix round 1, review round 2 (minor m3): DOWNLOAD_URL_MAX was unpinned.
  // A URL at exactly the cap is kept; one byte over is refused to NULL.
  // Mutation (measured by hand): removing `raw.length > DOWNLOAD_URL_MAX`
  // from `safeDownloadUrl` reds the second case (`over` would be kept).
  it('the length cap: exactly DOWNLOAD_URL_MAX is kept, one byte over is NULL', () => {
    const prefix = 'https://example.invalid/';
    const atCap = prefix + 'a'.repeat(DOWNLOAD_URL_MAX - prefix.length);
    const over = atCap + 'a';
    expect(atCap.length).toBe(DOWNLOAD_URL_MAX);
    expect(over.length).toBe(DOWNLOAD_URL_MAX + 1);
    expect(parseReleaseListing([withUrl(atCap)])!.rows[0]!.tarballUrl).toBe(atCap);
    expect(parseReleaseListing([withUrl(over)])!.rows[0]!.tarballUrl).toBeNull();
  });

  // Mutation: accepting http again (reverting to the old `DOWNLOAD_URL` regex)
  // reds the first case — measured by hand: swapping `safeDownloadUrl`'s
  // `u.protocol !== 'https:'` for the old `/^https?:\/\/\S+$/.test` accepts
  // the http case above and turns its `tarballUrl` non-null.

  // R7 (fix round 2, D-3216, review 143): a `\` before an authority-shaped
  // `@` is a measured parser differential — WHATWG (this process's own
  // parse) folds `\` to `/` on a special scheme and reads the whole
  // `\@evil.example/x` as PATH, with an empty username/password, while curl
  // 8.5.0 given the identical raw text connects to the host AFTER the `@`.
  // Refused outright — never parsed around, and never stored raw.
  it("R7: a backslash before an authority-shaped '@' is refused outright (github.com\\@evil.example)", () => {
    const p = parseReleaseListing([withUrl('https://github.com\\@evil.example/x')]);
    expect(p!.rows[0]!.tarballUrl).toBeNull();
  });

  // R7: the PARSED, NORMALISED form is stored — never the raw string. A
  // default port is the cleanest differential: WHATWG's `href` drops it,
  // so a raw string that still carries it proves `safeDownloadUrl` did not
  // just pass the raw value through.
  it('R7: the stored form is u.href, not the raw string — a default port is dropped', () => {
    const raw = 'https://example.invalid:443/ccrc-v0.0.9.tar.gz';
    const p = parseReleaseListing([withUrl(raw)]);
    expect(p!.rows[0]!.tarballUrl).toBe('https://example.invalid/ccrc-v0.0.9.tar.gz');
    expect(p!.rows[0]!.tarballUrl).not.toBe(raw);
  });

  // Mutations (measured by hand, each reds against this describe):
  // (1) removing `if (raw.includes('\\')) return null;` reds the backslash
  //     case above (WHATWG's own empty username/password checks do not
  //     catch it — `tarballUrl` would be non-null).
  // (2) reverting `return u.href` to `return raw` reds the default-port
  //     case above (`tarballUrl` would equal the raw string, port included).

  // S2 (fix round 2): `DOWNLOAD_URL_MAX` above bounds the RAW string, but R7
  // stores `u.href` — WHATWG percent-encoding can more than double a raw
  // string's length (each `"` becomes `%22`, 1 byte to 3). A raw string
  // comfortably under the cap can therefore percent-encode to a `tarballUrl`
  // well over the field's documented bound (D-3216) unless the STORED form
  // is re-checked. Mutation (measured by hand): removing the `u.href.length
  // > DOWNLOAD_URL_MAX` re-check reds this case (`tarballUrl` would be the
  // 2125-ish-char encoded string, not null).
  it('S2: the length cap also bounds the STORED href — a raw string under the cap can percent-encode over it', () => {
    const prefix = 'https://example.invalid/';
    const raw = prefix + '"'.repeat(700);
    expect(raw.length).toBeLessThanOrEqual(DOWNLOAD_URL_MAX);
    expect(new URL(raw).href.length).toBeGreaterThan(DOWNLOAD_URL_MAX);   // the percent-encoded form is what would be stored
    expect(parseReleaseListing([withUrl(raw)])!.rows[0]!.tarballUrl).toBeNull();
  });
});

describe('F11 (fix round 1, D-3216) — the tag ingress bound, on top of isReleaseTag', () => {
  it('a leading zero in any component but a bare 0 is skipped: v0.0.010, v01.2.3', () => {
    const p = parseReleaseListing([
      rel('v0.0.010', '2026-09-20T10:00:00Z'),
      rel('v01.2.3', '2026-09-20T10:01:00Z'),
      rel('v0.0.9', '2026-09-20T10:02:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual(['v0.0.9']);
    expect(p!.skipped).toBe(2);
  });

  it('a listing with both v0.0.10 and v0.0.010 stores one row — the malformed spelling never reaches the store', () => {
    const p = parseReleaseListing([
      rel('v0.0.10', '2026-09-20T10:00:00Z'),
      rel('v0.0.010', '2026-09-20T10:01:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual(['v0.0.10']);
    expect(p!.skipped).toBe(1);
  });

  // R9 (fix round 2, D-3216, review 143) changed what this pins: a
  // single-component tag AT the byte cap (the original `at64`, one
  // 59-digit component) is now ALSO skipped by the new per-component digit
  // cap (`RELEASE_TAG_COMPONENT_MAX_DIGITS`) — three components at that cap
  // is only 57 bytes, so the 64-byte cap is unreachable on its own for a
  // well-formed tag. The kept tag here is the true effective maximum under
  // BOTH caps; the skipped one still overshoots both.
  it('a grossly oversized single component is skipped; the effective maximum under both caps is kept', () => {
    const maxPart = '1'.repeat(RELEASE_TAG_COMPONENT_MAX_DIGITS);
    const atEffectiveMax = `v${maxPart}.${maxPart}.${maxPart}`;
    const over = `v${'1'.repeat(60)}.0.0`;
    expect(Buffer.byteLength(atEffectiveMax, 'utf8')).toBe(3 * RELEASE_TAG_COMPONENT_MAX_DIGITS + 3);
    expect(Buffer.byteLength(over, 'utf8')).toBe(65);
    const p = parseReleaseListing([
      rel(atEffectiveMax, '2026-09-20T10:00:00Z'),
      rel(over, '2026-09-20T10:01:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual([atEffectiveMax]);
    expect(p!.skipped).toBe(1);
  });

  it('v0.0.0 and v10.20.30 are kept — a bare 0 component and a multi-digit component are not leading zeros', () => {
    const p = parseReleaseListing([
      rel('v0.0.0', '2026-09-20T10:00:00Z'),
      rel('v10.20.30', '2026-09-20T10:01:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual(['v0.0.0', 'v10.20.30']);
    expect(p!.skipped).toBe(0);
  });

  // Mutations (measured by hand, each reds against this describe):
  // (1) removing the leading-zero rule from `isIngestibleReleaseTag`
  //     (`return true` in place of the `.every(...)`) admits v0.0.010 and
  //     v01.2.3 above — the first two cases in this describe go from
  //     skipped=2/1 to skipped=0.
  // (2) removing the byte-length bound (dropping the `Buffer.byteLength`
  //     check) does NOT by itself change the third case's outcome (R9, fix
  //     round 2: the per-component digit cap alone already refuses a
  //     60-digit component) — see the dedicated mutation note on
  //     `RELEASE_TAG_COMPONENT_MAX_DIGITS` in update-resolve.test.ts, whose
  //     removal DOES flip the third case's skipped count from 1 to 0.
});

describe('apiBaseProblem — validated once, at poller creation (D-3209, fix round 1 finding 3)', () => {
  it('a table of bases: https anywhere is fine; http only to a loopback host', () => {
    const cases: [string, boolean][] = [
      ['https://api.github.com', true],
      ['https://example.invalid', true],
      ['http://127.0.0.1:4000', true],
      ['http://[::1]:4000', true],
      ['http://localhost:4000', true],
      ['http://LOCALHOST:4000', true],
      ['http://example.invalid', false],
      ['http://api.github.com', false],
      ['https://api.github.com/?x=1', false],
      ['https://api.github.com/#frag', false],
      ['not a url at all', false],
      ['ftp://127.0.0.1', false],
    ];
    for (const [url, ok] of cases) {
      const problem = apiBaseProblem(url);
      if (ok) expect(problem, url).toBeNull();
      else expect(problem, url).not.toBeNull();
    }
  });

  it('B1/I1: a credentials-bearing base is refused with NO userinfo, scheme or host at all — the base-url-has-at word alone', () => {
    const problem = apiBaseProblem('https://user:hunter2@api.example.com');
    expect(problem).not.toBeNull();
    expect(problem).not.toMatch(/hunter2/);
    expect(problem).not.toMatch(/user:hunter2/);
    expect(problem).not.toContain('***@');   // F3: never a working URL, redacted or not
    expect(problem).toBe('apiUrl refused (base-url-has-at)');
  });

  // F3 (fix round 1, review run 134) + I1 (fix round 1, review round 2): a
  // raw base containing '@' ANYWHERE is refused before BASE_URL_OK even
  // runs, with its own word and no scheme/host suffix — regardless of where
  // WHATWG's own authority parsing would have put the '@'. This closes the
  // reviewer's finding that three of the ORIGINAL four inputs merely
  // happened to be unparseable (their userinfo's own `/`, `?` or `#`
  // terminates the authority before an `@` is found) while a sibling with no
  // such delimiter — a token used as a bare username, or one with no
  // password — parses FINE, puts the token's own head into `hostname`, and
  // would have printed part of it as "the host".
  it('I1: every base carrying \'@\' anywhere is refused base-url-has-at, with no scheme, host or secret fragment in the message', () => {
    const cases: string[] = [
      // The original four (F3), now moot as a parseability question — none
      // of them ever reach BASE_URL_OK.
      'https://user:se/cret@api.example.invalid',
      'https://user:se?cret@api.example.invalid',
      'https://user:se#cret@api.example.invalid',
      'u:pw@host',
      // The reviewer's I1 findings: no password, or a delimiter placing the
      // secret's head where BASE_URL_OK's own credential check cannot see
      // it (it inspects `u.username`/`u.password`, both empty here).
      'https://se?cret@api.example.invalid',
      'https://se#cret@api.example.invalid',
      'https://se\\cret@host?',
      'http://ghp_TOKEN/@api.example.invalid',
      'http://user:1234/x@host',
      // The related, closed-here-without-touching-base-url.ts case: BASE_URL_OK
      // alone ACCEPTS this (hostname `ghp_token`, https needs no loopback
      // check), which would send a live token out as a DNS lookup every poll.
      'https://ghp_TOKEN/@api.example.invalid',
    ];
    for (const raw of cases) {
      const problem = apiBaseProblem(raw);
      expect(problem, raw).toBe('apiUrl refused (base-url-has-at)');
    }
  });

  // Mutation (measured by hand): dropping the `'@'` check reds this case —
  // `https://ghp_TOKEN/@api.example.invalid` is then handed to `BASE_URL_OK`,
  // which ACCEPTS it (verified separately against the live `BASE_URL_OK`),
  // so `apiBaseProblem` would answer `null` and the poller would build a
  // request whose hostname IS the token.
  it('mutation control: BASE_URL_OK alone accepts the ghp_TOKEN base I1 refuses', () => {
    expect(BASE_URL_OK('https://ghp_TOKEN/@api.example.invalid').ok).toBe(true);
  });

  // R13 (fix round 2, review 143): `safeSchemeHost`'s docstring promises
  // "scheme and host only, never query/fragment/path" for a base that
  // parses fine but is refused for another reason (a query or a fragment) —
  // unpinned before this. A refused
  // `https://api.github.com/orgs/x?access_token=SECRET#frag` reaches it.
  it('R13: a refused base with a real host prints scheme and host ONLY — never its query, fragment or path', () => {
    const problem = apiBaseProblem('https://api.github.com/orgs/x?access_token=SECRET#frag');
    expect(problem).not.toBeNull();
    expect(problem).toBe('apiUrl refused (base-url-query): https://api.github.com');
    expect(problem).not.toContain('access_token');
    expect(problem).not.toContain('SECRET');
    expect(problem).not.toContain('orgs');
    expect(problem).not.toContain('frag');
  });

  // Mutation (measured by hand, on a scratch copy): appending `u.pathname` or
  // `u.search`/`u.hash` to `safeSchemeHost`'s return value reds the case
  // above — the message would then contain 'orgs', 'access_token' or 'frag'.
});

describe('capNotes — plain text, 4096 UTF-8 bytes, then the marker (§7, §18 "notes are capped and plain")', () => {
  it('a 5000-byte body is 4096 bytes plus the marker', () => {
    expect(NOTES_CAP_BYTES).toBe(4096);
    expect(NOTES_MARKER).toBe('…');
    expect(capNotes('a'.repeat(5000))).toBe(`${'a'.repeat(4096)}…`);
  });

  it('a body of exactly the cap is kept whole, with no marker', () => {
    expect(capNotes('a'.repeat(4096))).toBe('a'.repeat(4096));
  });

  it('the cut never splits a code point', () => {
    // '€' is three UTF-8 bytes: 1365 of them are 4095 bytes, the 1366th would cross 4096.
    const out = capNotes('€'.repeat(2000))!;
    expect(out).toBe(`${'€'.repeat(1365)}…`);
    expect(Buffer.byteLength(out.slice(0, -1), 'utf8')).toBe(4095);
    // A four-byte code point (a surrogate pair in JS) lands exactly on the cap.
    expect(capNotes('😀'.repeat(1100))).toBe(`${'😀'.repeat(1024)}…`);
  });

  it('no body is null — an empty string, a null, a non-string', () => {
    for (const b of ['', null, undefined, 12, { text: 'x' }]) expect(capNotes(b)).toBeNull();
  });
});

describe('the poller against a loopback fixture (design §7 Pins)', () => {
  type Answer = {
    status: number; etag?: string; body?: unknown;
    /** D-3209 fixtures: extra/override response headers, e.g. a declared
     *  `content-length` that lies about the actual body. */
    headers?: Record<string, string>;
    /** D-3209 fixtures: when set, ignores `body`, JSON.stringifies this and
     *  writes it in 64 KiB pieces via multiple `.write()` calls with NO
     *  `content-length` header — real chunked transfer-encoding, so the
     *  streamed-cap case reads genuine bytes off the wire rather than one
     *  buffered `.end()` call (which Node would auto-length). */
    chunkedBody?: unknown;
  } | 'hang';
  let server: Server;
  let base: string;
  let seen: { method: string; url: string; headers: IncomingMessage['headers'] }[];
  /** What the fixture answers, one entry per request, in order. */
  let script: Answer[];
  /** D-3215: the LATEST probe (`/releases/latest`) is a SECOND, independent
   *  request every poll now sends, routed by URL into its own queue and its
   *  own `seen` log — so `script`/`seen` above keep meaning "the listing"
   *  for every pre-existing case, unedited. Unscripted, it defaults to 404
   *  ("no stable release yet"), which is an ANSWER (D-3215): no store call,
   *  no warn, nothing for an old assertion to see. */
  let scriptLatest: Answer[];
  let seenLatest: { method: string; url: string; headers: IncomingMessage['headers'] }[];
  /** Fix round 1, item 5 (ruling A): the moved-away tag check
   *  (`/releases/tags/{k}`) is a THIRD, on-demand request — routed by URL
   *  into its own queue and its own `seen` log, so neither pre-existing
   *  queue above ever sees it. Unscripted, it defaults to a 500: a FAILURE
   *  (never an answer), so a pre-existing case that never expects this
   *  request to fire and never scripts it leaves K exactly where it was —
   *  the "nothing changes" arm, not a silent yank or upsert. */
  let scriptWithdrawn: Answer[];
  let seenWithdrawn: { method: string; url: string; headers: IncomingMessage['headers'] }[];

  const respond = (res: ServerResponse, a: Exclude<Answer, 'hang'>): void => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(a.headers ?? {}) };
    if (a.etag !== undefined) headers.etag = a.etag;
    if (a.chunkedBody !== undefined) {
      // Real chunked transfer-encoding: no content-length, written in 64
      // KiB pieces so the reader's running count actually crosses the cap
      // mid-stream rather than in one buffered `.end()` call.
      res.writeHead(a.status, headers);
      const text = JSON.stringify(a.chunkedBody);
      const CHUNK = 65_536;
      for (let i = 0; i < text.length; i += CHUNK) res.write(text.slice(i, i + CHUNK));
      res.end();
      return;
    }
    res.writeHead(a.status, headers);
    res.end(a.body === undefined ? '' : typeof a.body === 'string' ? a.body : JSON.stringify(a.body));
  };

  beforeEach(async () => {
    seen = [];
    script = [];
    seenLatest = [];
    scriptLatest = [];
    seenWithdrawn = [];
    scriptWithdrawn = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '';
      const isLatest = url.endsWith('/releases/latest');
      const isWithdrawn = /\/releases\/tags\//.test(url);
      const entry = { method: req.method ?? '', url, headers: req.headers };
      (isLatest ? seenLatest : isWithdrawn ? seenWithdrawn : seen).push(entry);
      const queue = isLatest ? scriptLatest : isWithdrawn ? scriptWithdrawn : script;
      const a = queue.shift() ?? (isLatest ? { status: 404 } : isWithdrawn ? { status: 500 } : { status: 500, body: 'fixture: no answer scripted' });
      if (a === 'hang') return;   // never answered — the deadline's case
      respond(res, a);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();   // a 'hang' request would otherwise hold close() open
    await new Promise<void>((r) => { server.close(() => r()); });
  });

  function fixture(): {
    store: CoordStore; port: CatalogueStore;
    calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage; keepTags: readonly string[]; withdrawTag: string | null }[];
  } {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('update-catalogue-'), 'coord.db')));
    const calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage; keepTags: readonly string[]; withdrawTag: string | null }[] = [];
    const port: CatalogueStore = {
      // Fix round 1, review round 2 (I3): forwards `keepTags` — a fixture
      // wrapper that silently dropped it would hide the whole mechanism
      // from every test in this file (measured: this WAS the bug on first
      // write, found by the I3 pin failing while the direct store-level
      // test passed). Fix round 1, item 5 (ruling A): forwards `withdrawTag`
      // for the same reason.
      applyReleaseListing(listing, now, coverage, keepTags = [], withdrawTag = null) {
        calls.push({ listing, now, coverage, keepTags, withdrawTag });
        return store.applyReleaseListing(listing, now, coverage, keepTags, withdrawTag);
      },
      newestUnyankedStable: () => store.newestUnyankedStable(),
    };
    return { store, port, calls };
  }

  function poller(port: CatalogueStore, over: Partial<{ source: ReleaseSourceRead; apiUrl: string; timeoutMs: number }> = {}): CataloguePoller {
    return createCataloguePoller({ source: SOURCE, apiUrl: base, store: port, ...over });
  }

  // D-3182: a fresh process says "never checked"
  // until its first answer — never "up to date", never an error it did not see.
  it('a fresh poller has never checked and has sent nothing', () => {
    const p = poller(fixture().port);
    expect(p.state()).toEqual({ lastOkAt: null, lastError: null });
    expect(p.lastRequestAt()).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('asks GitHub the documented question: one page of 30, the v3 media type, no token, no ETag yet', async () => {
    const { port } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    await poller(port).poll(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases?per_page=30');
    expect(seen[0]!.headers.accept).toBe('application/vnd.github+json');
    expect(seen[0]!.headers['user-agent']).toBe('ccrc-server');
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers['if-none-match']).toBeUndefined();
  });

  it('B2: a whitespace-padded base is trimmed to the SAME base the gate accepted, and the request lands on the right path', async () => {
    const { port } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    const padded = `  ${base}  `;
    expect(await poller(port, { apiUrl: padded }).poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases?per_page=30');
  });

  it('a second poll sends If-None-Match, and a 304 writes no rows but is an answer', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 304, etag: '"e1"' },
    ];
    const first = await p.poll(1000);
    expect(first).toEqual({ lastOkAt: 1000, lastError: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.coverage).toBe('complete');
    const rowsAfterFirst = store.releases();
    expect(rowsAfterFirst.map((r) => [r.tag, r.observedAt])).toEqual([['v0.0.2', 1000], ['v0.0.1', 1000]]);

    const second = await p.poll(2000);
    expect(seen[1]!.headers['if-none-match']).toBe('"e1"');
    expect(calls).toHaveLength(1);                     // the store was not asked
    expect(store.releases()).toEqual(rowsAfterFirst);  // observedAt did not move either
    expect(second).toEqual({ lastOkAt: 2000, lastError: null });
    expect(p.state()).toEqual(second);
    expect(p.lastRequestAt()).toBe(2000);
  });

  it('a 304 to a request that sent no ETag is not "not modified" — it is http-304', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 304 }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'http-304' } });
  });

  it('a release that vanishes from a complete listing is yanked, never deleted (§18 "a yanked release is kept")', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z')] },
    ];
    await p.poll(1000);
    await p.poll(2000);
    expect(store.releases().map((r) => [r.tag, r.yanked])).toEqual([['v0.0.2', false], ['v0.0.1', true]]);
  });

  // D-3206: GitHub still LISTS v0.0.1 on the
  // second poll, but its element's `prerelease` flag is a string (F10, fix
  // round 1: a lost/malformed tarball asset no longer skips the element —
  // see the parser-level cases below — so a genuinely structural defect is
  // what triggers a skip now), so the parser skips it and the store never
  // sees it. The row reads absent for that poll and is yanked, which is
  // fail-closed: it was not upserted, so its columns are the first poll's.
  // It is kept, not rewritten, and it comes back on the first poll that
  // parses it.
  it('a known release whose element is skipped is yanked for that poll, and comes back when it parses again', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    const v1 = rel('v0.0.1', '2026-09-01T00:00:00Z');
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), v1] },
      { status: 200, etag: '"e2"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), { ...v1, prerelease: 'yes' }] },
      { status: 200, etag: '"e3"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), v1] },
    ];
    await p.poll(1000);
    expect((await p.poll(2000)).lastError).toBeNull();
    expect(calls[1]!.listing.map((r) => r.tag)).toEqual(['v0.0.2']);   // the skip happened in the parser
    expect(calls[1]!.coverage).toBe('complete');                          // the RAW body held 2 elements
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt, r.tarballUrl])).toEqual([
      ['v0.0.2', false, 2000, 'https://example.invalid/releases/download/v0.0.2/ccrc-v0.0.2.tar.gz'],
      ['v0.0.1', true, 1000, 'https://example.invalid/releases/download/v0.0.1/ccrc-v0.0.1.tar.gz'],
    ]);
    await p.poll(3000);
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt])).toEqual([
      ['v0.0.2', false, 3000],
      ['v0.0.1', false, 3000],
    ]);
  });

  it('prerelease: true reaches the store as dev, and the .sigstore.json asset as bundleListed', async () => {
    const { store, port } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [
      rel('v0.0.2', '2026-09-02T00:00:00Z', { prerelease: true }),
      rel('v0.0.1', '2026-09-01T00:00:00Z', {
        assets: [{ name: 'ccrc-v0.0.1.tar.gz', browser_download_url: 'https://example.invalid/t1.tar.gz' }],
      }),
    ] }];
    await poller(port).poll(1000);
    expect(store.releases().map((r) => [r.tag, r.channel, r.bundleListed])).toEqual([
      ['v0.0.2', 'dev', true],
      ['v0.0.1', 'stable', false],
    ]);
  });

  it('a 403 is rate-limited: every prior row intact, lastOkAt unchanged (§18 "errors never move lastOkAt")', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 403, body: { message: 'API rate limit exceeded' } },
      { status: 429, body: { message: 'slow down' } },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'rate-limited' } });
    expect(await p.poll(3000)).toEqual({ lastOkAt: 1000, lastError: { at: 3000, reason: 'rate-limited' } });
    expect(store.releases()).toEqual(before);
    expect(calls).toHaveLength(1);
  });

  it('any other status is http-<status>, and lastOkAt stays null on a catalogue that never answered', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 500 }, { status: 404, body: { message: 'Not Found' } }, { status: 204 }];
    expect((await p.poll(1000)).lastError).toEqual({ at: 1000, reason: 'http-500' });
    expect((await p.poll(2000)).lastError).toEqual({ at: 2000, reason: 'http-404' });
    expect(await p.poll(3000)).toEqual({ lastOkAt: null, lastError: { at: 3000, reason: 'http-204' } });
  });

  // D-3197: lastError is the CURRENT failure, so a recovery
  // clears it; lastOkAt is when the catalogue was last known good.
  it('an answer after an error clears lastError', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 502 }, { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    expect((await p.poll(1000)).lastError).toEqual({ at: 1000, reason: 'http-502' });
    expect(await p.poll(2000)).toEqual({ lastOkAt: 2000, lastError: null });
  });

  it('a refused connection is no-egress', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const deadPort = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => { dead.close(() => r()); });
    const p = poller(fixture().port, { apiUrl: `http://127.0.0.1:${deadPort}` });
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-egress' } });
    expect(p.lastRequestAt()).toBe(1000);   // a request was attempted, and it counts against the minute
  });

  it('a server that never answers is no-egress at the deadline, and the poll resolves', async () => {
    const p = poller(fixture().port, { timeoutMs: 200 });
    script = ['hang'];
    const t0 = Date.now();
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-egress' } });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(seen).toHaveLength(1);
  }, 10_000);

  it('an unparseable or non-array body is malformed, and the ETag of the last ACCEPTED listing is kept', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: 'not json at all' },
      { status: 200, etag: '"e3"', body: { releases: [] } },
      { status: 304, etag: '"e1"' },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'malformed' } });
    expect(await p.poll(3000)).toEqual({ lastOkAt: 1000, lastError: { at: 3000, reason: 'malformed' } });
    expect(store.releases()).toEqual(before);
    await p.poll(4000);
    expect(seen.map((s) => s.headers['if-none-match'])).toEqual([undefined, '"e1"', '"e1"', '"e1"']);
  });

  it('a store refusal is malformed: an empty listing while rows are known writes nothing (Task 4, D-3185)', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: [] },
      { status: 304, etag: '"e1"' },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'malformed' } });
    expect(calls).toHaveLength(2);                     // the store WAS asked, and refused
    expect(store.releases()).toEqual(before);          // nothing yanked by a transient []
    await p.poll(3000);
    expect(seen[2]!.headers['if-none-match']).toBe('"e1"');   // e2 was never accepted
  });

  it('a full page reaches the store as newest-page even when an element was skipped', async () => {
    const { port, calls } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [...page(29), { tag_name: 'garbage' }] }];
    expect((await poller(port).poll(1000)).lastError).toBeNull();
    expect(calls[0]!.listing).toHaveLength(29);
    expect(calls[0]!.coverage).toBe('newest-page');
  });

  it('no release source: no request at all, and the reason says why', async () => {
    const { port, calls } = fixture();
    const p = poller(port, { source: { ok: false, why: 'tree-absent', path: '/nonexistent/ccrc/ccd/ccrc' } });
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-release-source' } });
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(p.lastRequestAt()).toBeNull();   // nothing was spent against the hour's budget
  });

  it('single-flight: a poll during a poll returns the in-flight promise — one request', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    const a = p.poll(1000);
    const b = p.poll(1001);
    expect(b).toBe(a);
    expect(await a).toEqual({ lastOkAt: 1000, lastError: null });
    expect(seen).toHaveLength(1);
    // Once settled, the next poll is a new request.
    script = [{ status: 304, etag: '"e1"' }];
    await p.poll(2000);
    expect(seen).toHaveLength(2);
  });

  it('state() is a copy — a caller cannot edit the poller\'s memory', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 500 }];
    await p.poll(1000);
    const s = p.state();
    s.lastError!.reason = 'edited';
    s.lastOkAt = 99;
    expect(p.state()).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'http-500' } });
  });

  // D-3209 (fix round 1, findings 1-3): a hostile or oversized listing must
  // never reach JSON.parse or the store, and a bad apiUrl never sends a
  // request at all.
  it('D-3209: a declared content-length over the cap refuses without reading a byte', async () => {
    const { port, calls } = fixture();
    const p = poller(port);
    script = [{
      status: 200, etag: '"e1"',
      headers: { 'content-length': String(CATALOGUE_BODY_MAX_BYTES + 1) },
      body: '[]',
    }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'malformed' } });
    expect(calls).toHaveLength(0);
  });

  it('D-3209: a streamed body over the cap with no content-length is malformed', async () => {
    const { port } = fixture();
    const p = poller(port);
    // A real, VALID JSON payload — if the cap did not stop the read, this
    // would parse and the single release would upsert cleanly (capNotes
    // truncates the pathological `body`), so removing the guard genuinely
    // changes the answer rather than failing to parse either way.
    const paddedNotes = 'x'.repeat(CATALOGUE_BODY_MAX_BYTES + 200_000);
    script = [{
      status: 200, etag: '"e1"',
      chunkedBody: [rel('v0.0.1', '2026-09-01T00:00:00Z', { body: paddedNotes })],
    }];
    const t0 = Date.now();
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'malformed' } });
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10_000);

  it('D-3209: a raw array longer than RELEASES_PER_PAGE is malformed, and nothing is written', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [{ status: 200, etag: '"e1"', body: page(RELEASES_PER_PAGE + 1) }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'malformed' } });
    expect(calls).toHaveLength(0);
    expect(store.releases()).toEqual([]);
  });

  it('D-3209: a store that throws answers malformed rather than rejecting, and lastOkAt stays at its last success', async () => {
    const { store } = fixture();
    let calls = 0;
    const throwingPort: CatalogueStore = {
      applyReleaseListing(listing, now, coverage) {
        calls += 1;
        if (calls === 2) throw new Error('boom');
        return store.applyReleaseListing(listing, now, coverage);
      },
    };
    const p = poller(throwingPort);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 304 },
    ];
    expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
    await expect(p.poll(2000)).resolves.toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'malformed' } });
    // B5: the store's throw on poll 2 must not adopt "e2" — the NEXT request
    // still carries the ETag of the last ACCEPTED listing ("e1"), never the
    // one the throwing call was handed.
    await p.poll(3000);
    expect(seen.at(-1)!.headers['if-none-match']).toBe('"e1"');
  });

  it('B6: a store throw is warned ONCE per distinct message, quiet on a repeat, and re-armed after a success', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let mode: 'boom' | 'ok' | 'other' = 'boom';
      const throwingPort: CatalogueStore = {
        applyReleaseListing() {
          if (mode === 'boom') throw new Error('boom');
          if (mode === 'other') throw new Error('other cause');
          return { ok: true, upserted: 1, yanked: 0, unyanked: 0 };
        },
      };
      const p = poller(throwingPort);
      script = [
        { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
        { status: 200, etag: '"e2"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
        { status: 200, etag: '"e3"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
        { status: 200, etag: '"e4"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      ];
      // Two identical failures ("boom") → one warn.
      await p.poll(1000);
      await p.poll(2000);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('boom'))).toHaveLength(1);
      // A success resets the dedupe — re-review finding 3 (final fix wave):
      // the ORIGINAL version of this case re-threw a DIFFERENT message
      // ('other cause') here, which would warn again whether or not the
      // reset ran (a new message always clears the old dedupe key). Re-throw
      // the SAME message ('boom') instead: this only warns a second time if
      // the success actually cleared `lastWarnedStoreError`.
      mode = 'ok';
      await p.poll(3000);
      mode = 'boom';
      await p.poll(4000);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('boom'))).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('D-3209: a poller built on a bad apiUrl sends no request, ever', async () => {
    const { port, calls } = fixture();
    const p = poller(port, { apiUrl: 'http://example.invalid' });   // http, non-loopback
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-release-source' } });
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(p.lastRequestAt()).toBeNull();
  });

  // N2 (fix round 1, re-review round 2): the previous case's bad base is
  // ALSO refused by `BASE_URL_OK` on its own (non-loopback http), so it
  // never actually exercised the `'@'` refusal's OWN gate at `pollOnce`'s
  // `baseProblem !== null` check — a base built from THIS loopback fixture
  // (which `BASE_URL_OK` alone WOULD accept: http, loopback host) is used
  // here instead, so only the `'@'` check stands between it and a real
  // request. Mutation (measured by hand): dropping `baseProblem !== null`
  // from `pollOnce`'s early-return (leaving only `validatedBase === null`)
  // reds this case — `validatedBase` is non-null (BASE_URL_OK accepts the
  // loopback host), so the poll would send both requests, one of them
  // carrying `/@x`'s host-shaped credential.
  it("N2: a base containing '@' that BASE_URL_OK alone would accept sends NO request", async () => {
    const { port, calls } = fixture();
    const p = poller(port, { apiUrl: `${base}/@x` });
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-release-source' } });
    expect(seen).toHaveLength(0);
    expect(seenLatest).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(p.lastRequestAt()).toBeNull();
  });

  // F9 (fix round 1): `redirect: 'error'` on the LISTING fetch. Mutation
  // (measured by hand): removing `redirect: 'error'` from the listing's
  // `fetch(...)` call makes node's `fetch` FOLLOW the 302 instead — this
  // case reds because `seen` gets no second entry from this fixture (the
  // follow goes off this loopback server) and the poll instead resolves
  // `no-egress` (or hangs past the deadline), never `redirect`. The
  // `Location` is a LOOPBACK address (fix round 1, review round 2, minor
  // m6) — under the mutation this really is followed, so a real external
  // host here would make a genuine DNS lookup / network hop from this test.
  it('F9: a redirect on the listing is its own reason — never folded into no-egress — no row written, lastOkAt unmoved', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [{ status: 302, headers: { location: 'http://127.0.0.1:9/' } }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'redirect' } });
    expect(store.releases()).toEqual([]);
  });

  it('F9: a redirect on the latest probe only warns — never lastError, never lastOkAt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { port } = fixture();
      const p = poller(port);
      script = [{ status: 200, etag: '"eL"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
      scriptLatest = [{ status: 302, headers: { location: 'http://127.0.0.1:9/' } }];
      expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
      expect(warn.mock.calls.some((c) => String(c[0]).includes('redirect'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  describe('D-3215 — the latest-release probe (an off-page stable is not silently unresolvable)', () => {
    it('an off-page stable becomes a listed row via the latest probe, and resolve gives \'*\' -> that stable', async () => {
      const { store, port } = fixture();
      const p = poller(port);
      // A full page of 30 dev prereleases, all newer than the stable release,
      // which never appears on it (§7's window; the coordinator's measured facts).
      const listingBody = Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
        rel(`v0.1.${i + 1}`, new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), { prerelease: true }));
      script = [{ status: 200, etag: '"eL"', body: listingBody }];
      scriptLatest = [{ status: 200, etag: '"eS"', body: rel('v0.0.1', '2026-08-01T00:00:00Z') }];
      expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
      const releases = store.releases();
      const stableRow = releases.find((r) => r.tag === 'v0.0.1');
      expect(stableRow).toMatchObject({ tag: 'v0.0.1', channel: 'stable', yanked: false });
      // The load-bearing half of 'single': the latest upsert must not yank
      // ANY of the 30 dev releases the listing just wrote in the SAME poll.
      // R3 (fix round 2, review 143) CORRECTS the claim this comment used to
      // make: passing 'complete' here does NOT red this assertion — N1's
      // reordering (the probe runs BEFORE the listing) means the listing
      // that follows, in this SAME poll, re-upserts the 30 dev rows with
      // `yanked = 0` before this assertion ever looks, masking a wrong
      // coverage word here. The guard IS real; it just cannot be seen from
      // this vantage — see the dedicated case below, which asserts on a
      // poll where the listing itself fails, so nothing can re-upsert
      // anything afterward.
      expect(releases.filter((r) => r.tag !== 'v0.0.1').every((r) => !r.yanked)).toBe(true);
      expect(releases).toHaveLength(RELEASES_PER_PAGE + 1);

      const eligibility: EligibilityRow[] = releases.map((r) => ({
        tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked,
      }));
      const input: ResolveInput = {
        // A floor below the off-page stable — 'v0.0.0', not measured on this
        // node's `~/.ccrc/floor` (`floorRead: 'absent'` = unconstrained) —
        // so the stable release resolves as strictly newer than it.
        currentVersion: 'v0.0.0', highestVersion: null, floorRead: 'absent',
        nodeIntent: null, fleetIntent: { channel: 'stable', pinnedTag: null, auto: 'off' },
        releases: eligibility, refusedByThisNode: new Set<string>(),
      };
      expect(resolveNodeIntent(input).desiredStable).toBe('v0.0.1');

      // The pin: a LATER full-coverage-window listing that still omits the
      // stable tag must not yank it — `since` (the oldest publishedAt in a
      // `newest-page` listing) sits above the stable's own, older, publishedAt.
      const listingBody2 = Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
        rel(`v0.1.${i + 31}`, new Date(Date.UTC(2026, 8, 3, 0, i)).toISOString(), { prerelease: true }));
      script = [{ status: 200, etag: '"eL2"', body: listingBody2 }];
      scriptLatest = [{ status: 304, etag: '"eS"' }];
      await p.poll(2000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ tag: 'v0.0.1', yanked: false });
    });

    // R3 (fix round 2, review 143): the guard the case above could no
    // longer catch, made red again — assert on a poll where the LISTING
    // ITSELF FAILS, so nothing can re-upsert anything after the /latest
    // probe's own upsert runs, and the coverage word it used is directly
    // observable.
    it("R3: the latest upsert's 'single' coverage is provable on a poll where the listing fails — nothing can mask it afterward", async () => {
      const { store, port } = fixture();
      const p = poller(port);
      // Poll 1: 30 known dev releases, no stable yet (latest unscripted -> 404, an answer).
      const listingBody = Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
        rel(`v0.2.${i + 1}`, new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), { prerelease: true }));
      script = [{ status: 200, etag: '"eL1"', body: listingBody }];
      await p.poll(1000);
      expect(store.releases()).toHaveLength(RELEASES_PER_PAGE);

      // Poll 2: the latest probe confirms a NEW stable release, but the
      // LISTING FAILS this same poll (500) — its own re-upsert, which
      // masked the mutant above, cannot run here.
      script = [{ status: 500 }];
      scriptLatest = [{ status: 200, etag: '"eS"', body: rel('v0.0.1', '2026-08-01T00:00:00Z') }];
      await p.poll(2000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      expect(store.releases().filter((r) => r.tag !== 'v0.0.1').every((r) => !r.yanked)).toBe(true);
      expect(store.releases()).toHaveLength(RELEASES_PER_PAGE + 1);
    });

    // Mutation (measured by hand, on a scratch copy): passing 'complete'
    // instead of 'single' to `pollLatest`'s OWN `applyReleaseListing` call
    // reds the case above — with 30 known dev releases already in the store
    // and none of them named in `[row]`, a 'complete' coverage yanks every
    // one of them, and the listing's own 500 this poll never gets a chance
    // to re-upsert them.

    it('a 304 on the latest probe writes nothing, and it carries its OWN ETag — independent of the listing\'s', async () => {
      const { store, port, calls } = fixture();
      const p = poller(port);
      script = [
        { status: 200, etag: '"eL1"', body: [rel('v0.0.5', '2026-09-05T00:00:00Z')] },
        { status: 304, etag: '"eL1"' },
      ];
      scriptLatest = [
        { status: 200, etag: '"eS1"', body: rel('v0.0.5', '2026-09-05T00:00:00Z') },
        { status: 304, etag: '"eS1"' },
      ];
      await p.poll(1000);
      expect(calls).toHaveLength(2);   // the listing AND the latest, both applied
      const before = store.releases();
      await p.poll(2000);
      expect(calls).toHaveLength(2);   // neither request wrote again
      expect(store.releases()).toEqual(before);
      expect(seenLatest[1]!.headers['if-none-match']).toBe('"eS1"');
      expect(seen[1]!.headers['if-none-match']).toBe('"eL1"');
    });

    // I2 (fix round 1, review round 2): a 404 must warn NOTHING — the only
    // observable difference between "correctly answered" and "wrongly
    // treated as a failure" is the warn (both leave lastError/lastOkAt
    // alone), so the warn assertion is the one that actually reds under the
    // reviewer's M14 mutation (`warnLatest('http-404')` instead of
    // `latestAnswered()`).
    it('a 404 on the latest probe is an ANSWER, not an error — lastError stays null, lastOkAt moves with the listing, and NOTHING is warned', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { port } = fixture();
        const p = poller(port);
        script = [{ status: 200, etag: '"eL"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
        scriptLatest = [{ status: 404 }];
        expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
        expect(p.state()).toEqual({ lastOkAt: 1000, lastError: null });   // I2: post-probe state, not just the return
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    // R12 (fix round 2, review 143): the 404-WITH-A-KEPT-K branch also calls
    // `latestAnswered()` (D-3215's own claim: a 404 is a clean answer,
    // re-arming the probe's warning dedupe) — but nothing pinned it, since
    // every existing 404 case had NO kept tag yet (the `k === null` branch
    // above, which already has its own warn assertion). This proves the
    // dedupe genuinely resets: a warned cause, then a kept-K 404, then the
    // SAME cause again — a second warn only fires if the reset really ran.
    it("R12: a 404 with a kept K re-arms the probe's warning dedupe — the same cause warns again after it", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { port } = fixture();
        const p = poller(port);
        script = [
          { status: 200, etag: '"eL1"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
          { status: 200, etag: '"eL2"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
          { status: 200, etag: '"eL3"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
          { status: 200, etag: '"eL4"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS"', body: rel('v0.0.1', '2026-08-01T00:00:00Z') },   // establishes K
          { status: 500 },    // poll 2: warns 'http-500' — dedupe armed
          { status: 404 },    // poll 3: a kept-K 404 — an ANSWER; should re-arm the dedupe
          { status: 500 },    // poll 4: the SAME cause — must warn again if the dedupe reset
        ];
        // A DIFFERENT failure code than the /latest probe's own — the two
        // dedupe keys are independent, and a 'http-500' from THIS check
        // would otherwise collide with the assertion below.
        scriptWithdrawn = [{ status: 502 }];
        await p.poll(1000);
        await p.poll(2000);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(1);
        await p.poll(3000);
        expect(warn.mock.calls.some((c) => String(c[0]).includes('http-404'))).toBe(false);   // still an answer, never a failure
        await p.poll(4000);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(2);
      } finally {
        warn.mockRestore();
      }
    });

    // Mutation (measured by hand, on a scratch copy): removing the
    // `latestAnswered()` call from the 404-with-kept-K branch reds the case
    // above — poll 4's 'http-500' warn count stays at 1, since the dedupe
    // key from poll 2 was never cleared.

    it('a failed latest fetch with an OK listing: lastOkAt moves, lastError null, ONE warn per distinct cause, re-armed by the next latest success', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { port } = fixture();
        const p = poller(port);
        script = [
          { status: 200, etag: '"eL1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
          { status: 200, etag: '"eL2"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
          { status: 200, etag: '"eL3"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
        ];
        scriptLatest = [
          { status: 500 },
          { status: 500 },
          { status: 200, etag: '"eS"', body: rel('v0.0.2', '2026-09-02T00:00:00Z') },
        ];
        expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
        expect(p.state()).toEqual({ lastOkAt: 1000, lastError: null });   // I2
        expect(await p.poll(2000)).toEqual({ lastOkAt: 2000, lastError: null });
        expect(p.state()).toEqual({ lastOkAt: 2000, lastError: null });   // I2
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(1);
        await p.poll(3000);   // the latest answers 200 this time — re-arms the dedupe
        scriptLatest = [{ status: 500 }];
        await p.poll(4000);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(2);
      } finally {
        warn.mockRestore();
      }
    });

    // I2 (fix round 1, review round 2), M17: a FAILURE answer that itself
    // carries an `etag` header must never advance `latestEtag` — only a
    // successfully-applied 200 does. Proven by sending an etag on a 500 and
    // checking the NEXT request still carries the LAST GOOD etag (here,
    // none yet, so no `if-none-match` at all — never the 500's).
    it('a failure answer that carries an etag does not advance latestEtag', async () => {
      const { port } = fixture();
      const p = poller(port);
      script = [
        { status: 200, etag: '"eL1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
        { status: 200, etag: '"eL2"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      ];
      scriptLatest = [
        { status: 500, etag: '"bad"' },
        { status: 200, etag: '"eS"', body: rel('v0.0.2', '2026-09-02T00:00:00Z') },
      ];
      await p.poll(1000);   // seenLatest[0]: the 500 that carries "bad"
      await p.poll(2000);   // seenLatest[1]: must NOT carry the 500's etag
      expect(seenLatest[1]!.headers['if-none-match']).toBeUndefined();   // never '"bad"'
    });

    // I3 (fix round 1, review round 2): the reviewer's measured yank-flap
    // sequence. A release whose `publishedAt` sits INSIDE the listing's own
    // window (>= the oldest listed one) but is not itself listed (it sorted
    // off page 1 by whatever order GitHub used) would, before this fix, be
    // yanked by poll 2's listing (a real observation) and never recover once
    // the latest probe stops sending a fresh 200 (a 304 writes nothing) —
    // exactly the failure D-3215 exists to fix, reappearing one layer down.
    it('I3: the listing never yanks the tag the latest probe last confirmed, across a 304 that writes nothing', async () => {
      const { store, port } = fixture();
      const p = poller(port);
      // 30 dev releases published every minute from :00 to :29; the stable
      // release published INSIDE that span (:15:30) but never listed.
      const listingBody = Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
        rel(`v0.1.${i + 1}`, new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), { prerelease: true }));
      const stableAt = new Date(Date.UTC(2026, 8, 2, 0, 15, 30)).toISOString();
      script = [
        { status: 200, etag: '"eL1"', body: listingBody },
        { status: 200, etag: '"eL2"', body: listingBody },
        { status: 200, etag: '"eL3"', body: listingBody },
      ];
      scriptLatest = [
        { status: 200, etag: '"eS"', body: rel('v0.0.1', stableAt) },
        { status: 304, etag: '"eS"' },
        { status: 304, etag: '"eS"' },
      ];
      await p.poll(1000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      await p.poll(2000);   // listing 200 (does NOT list v0.0.1), latest 304
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      await p.poll(3000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      // And it still resolves — the whole point of D-3215.
      const eligibility: EligibilityRow[] = store.releases().map((r) => ({
        tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked,
      }));
      const input: ResolveInput = {
        currentVersion: 'v0.0.0', highestVersion: null, floorRead: 'absent',
        nodeIntent: null, fleetIntent: { channel: 'stable', pinnedTag: null, auto: 'off' },
        releases: eligibility, refusedByThisNode: new Set<string>(),
      };
      expect(resolveNodeIntent(input).desiredStable).toBe('v0.0.1');
    });

    // I-3 (fix round 1, review round 2, findings dispatch fr1-D — the "any
    // other probe failure keeps the remembered tag" arm had NO test that
    // could go red): the reviewer's measured harm sequence — 200 K, then a
    // TRANSIENT probe failure, then a 304 — must leave K kept and un-yanked
    // throughout. A probe failure is not a "moved away" signal (ruling A
    // reserves that for a clean 404 or a clean 200 naming an older tag); it
    // is simply unanswered, and the previous confirmation stands.
    it('I-3: a transient probe failure (502, then a timeout-shaped over-cap) between two confirmations never clears the kept tag', async () => {
      const { store, port } = fixture();
      const p = poller(port);
      const listingBody = Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
        rel(`v0.1.${i + 1}`, new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString(), { prerelease: true }));
      const stableAt = new Date(Date.UTC(2026, 8, 2, 0, 15, 30)).toISOString();
      script = [
        { status: 200, etag: '"eL1"', body: listingBody },
        { status: 200, etag: '"eL2"', body: listingBody },
        { status: 200, etag: '"eL3"', body: listingBody },
        { status: 200, etag: '"eL4"', body: listingBody },
      ];
      scriptLatest = [
        { status: 200, etag: '"eS"', body: rel('v0.0.1', stableAt) },
        { status: 502 },                                                        // a plain transient failure
        { status: 200, headers: { 'content-length': String(CATALOGUE_BODY_MAX_BYTES + 1) } },   // over-cap
        { status: 304, etag: '"eS"' },                                          // the tag was never disturbed
      ];
      await p.poll(1000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      await p.poll(2000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      await p.poll(3000);
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
      await p.poll(4000);
      // The 304 above only answers a request that still carries "eS" — proof
      // that neither failure moved latestEtag off the original confirmation.
      expect(seenLatest[3]!.headers['if-none-match']).toBe('"eS"');
      expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
    });

    // N1 (fix round 2, re-review): the I3 fix above (D-3215) had a
    // regression — the keep it computed was ONE POLL STALE (the listing ran
    // BEFORE the probe), the listing's own ETag advanced on the poll that
    // applied the stale keep (so a LATER listing answers 304 and writes
    // nothing), and a 404 never released the tag it had last kept. Together
    // these meant a genuinely WITHDRAWN stable release could stay
    // `yanked: false` — and resolve as the fleet's desired stable — forever.
    // The fix: the probe runs FIRST, so `pollListing` always reads THIS
    // poll's answer; a 404 clears the kept tag; and the listing's ETag is
    // dropped whenever the kept tag changes, forcing a full re-judgment.
    describe('N1 — a withdrawn stable release is still yanked (the I3 keep is never more than one poll fresh)', () => {
      it('(a) stable S2 deleted; /latest moves to the older S1 -> S2 is yanked on that poll, \'*\' -> S1', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s1 = rel('v0.0.1', '2026-08-01T00:00:00Z');
        const s2 = rel('v0.0.2', '2026-08-15T00:00:00Z');
        script = [
          { status: 200, etag: '"eL1"', body: [s2, s1] },
          { status: 200, etag: '"eL2"', body: [s1] },   // S2 deleted from the listing
        ];
        scriptLatest = [
          { status: 200, etag: '"eS2"', body: s2 },
          { status: 200, etag: '"eS1"', body: s1 },     // /latest moves down to the older release
        ];
        // Fix round 1, item 5 (ruling A): /latest naming S1 (older than the
        // kept K=S2) triggers ONE targeted `GET /releases/tags/v0.0.2` — a
        // 404 confirms S2 is truly gone.
        scriptWithdrawn = [{ status: 404 }];
        await p.poll(1000);
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: false });
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(1);
        expect(seenWithdrawn[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases/tags/v0.0.2');
        // The listing's ETag was dropped because the kept tag changed —
        // verify the SECOND listing request carried no If-None-Match at all.
        expect(seen[1]!.headers['if-none-match']).toBeUndefined();
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: true });
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });

        const eligibility: EligibilityRow[] = store.releases().map((r) => ({
          tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked,
        }));
        const input: ResolveInput = {
          currentVersion: 'v0.0.0', highestVersion: null, floorRead: 'absent',
          nodeIntent: null, fleetIntent: { channel: 'stable', pinnedTag: null, auto: 'off' },
          releases: eligibility, refusedByThisNode: new Set<string>(),
        };
        expect(resolveNodeIntent(input).desiredStable).toBe('v0.0.1');
      });

      it('(b) a stable release withdrawn to draft (absent from the listing), /latest moving to an older one -> yanked', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s0 = rel('v0.0.0', '2026-07-01T00:00:00Z');   // the eventual new latest
        const s1 = rel('v0.0.1', '2026-08-01T00:00:00Z');   // withdrawn to draft
        script = [
          { status: 200, etag: '"eL1"', body: [s1, s0] },
          { status: 200, etag: '"eL2"', body: [s0] },       // v0.0.1 no longer listed — a draft is never listed
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: s1 },
          { status: 200, etag: '"eS0"', body: s0 },         // /latest moves down to v0.0.0
        ];
        // Fix round 1, item 5 (ruling A): converting to a draft does not
        // delete the release — GitHub's own tag endpoint still answers 200,
        // now with draft: true, which the ordinary birth rule yanks.
        scriptWithdrawn = [{ status: 200, etag: '"eS1d"', body: { ...s1, draft: true } }];
        await p.poll(1000);
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
        await p.poll(2000);
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: true });
      });

      it('(c) the only stable release deleted, /latest answering 404 -> yanked, and the kept tag clears', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s1 = rel('v0.0.1', '2026-08-01T00:00:00Z');
        // A noise dev release keeps the listing non-empty on poll 2 — an
        // empty listing while releases are known is refused outright
        // (D-3185's 'empty-listing'), which would make this pin vacuous.
        const noise = rel('v0.1.1', '2026-08-02T00:00:00Z', { prerelease: true });
        script = [
          { status: 200, etag: '"eL1"', body: [noise, s1] },
          { status: 200, etag: '"eL2"', body: [noise] },    // v0.0.1 deleted
          { status: 200, etag: '"eL3"', body: [noise] },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: s1 },
          { status: 404 },                                  // no stable release exists any more
          { status: 404 },
        ];
        // Fix round 1, item 5 (ruling A): a bare 404 on /latest with a kept
        // K still triggers the targeted check — a second 404 confirms K
        // itself is truly gone.
        scriptWithdrawn = [{ status: 404 }];
        await p.poll(1000);
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
        await p.poll(2000);
        expect(seenWithdrawn[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases/tags/v0.0.1');
        // The listing's ETag was dropped because the confirmed withdrawal
        // cleared the kept tag — verify no If-None-Match was sent on the
        // second listing request.
        expect(seen[1]!.headers['if-none-match']).toBeUndefined();
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: true });
        // m6 (fix round 1 review, re-measured under ruling A): the CONFIRMED
        // withdrawal also cleared latestEtag — the third /latest request
        // carries no If-None-Match either (never a stale ETag off the row
        // that no longer exists).
        await p.poll(3000);
        expect(seenLatest[2]!.headers['if-none-match']).toBeUndefined();
      });

      // (d) is the pre-existing 'I3: …' case above, unmodified: the stable
      // release stays unyanked across a 200-then-304-then-304 sequence where
      // the KEPT tag never actually changes — proving this fix does not
      // reintroduce the ORIGINAL I3 failure it is layered on top of.

      // Mutations (measured by hand, each reds a case above):
      // (1) R15 (fix round 2, review 143) CORRECTS this entry: reverting to
      //     the old order (`pollListing` before `pollLatest`) does NOT red
      //     case (a) — measured, on a scratch copy, against this file's
      //     FULL suite. Ruling A's own tag-check mechanism yanks S2 anyway
      //     once the check resolves, regardless of which request ran first
      //     this poll, so (a)'s own assertions stay green. The mutation
      //     reds three OTHER, pre-existing cases instead, and the mechanism
      //     is the SAME one in both: the `etag = null` reset (item 3 below)
      //     was written to run BEFORE the listing, so a kept-tag change
      //     this poll forces the listing's NEXT request fresh; flipped, it
      //     now runs AFTER a listing that already sent its own (stale-keep)
      //     request and set its own `etag` — so the reset wipes the value
      //     the listing JUST fetched, and the very next poll's listing
      //     carries no If-None-Match at all ('a 304 on the latest probe
      //     writes nothing … independent of the listing's' reds on its
      //     `seen[1]` header assertion). The SAME reordering also means a
      //     fresh poller's very first listing call now runs BEFORE any
      //     stable release is known, so its own 'complete' upsert plants
      //     the store's first stable row itself — `currentK()` then reads
      //     that row back on the SAME poll's `pollLatest`, so a bare 404
      //     with genuinely nothing known yet is wrongly read as a
      //     moved-away signal and fires an extra, unscripted confirming
      //     request that warns ('a 404 on the latest probe is an ANSWER …
      //     NOTHING is warned' reds on its warn-count assertion; ruling A's
      //     own '(e) after a restart …' reds the same way, on its
      //     confirming-request-count assertion). C5 (fix round 2, review
      //     143) CORRECTS this list: it is FOUR reds, not three — the same
      //     spurious "K already known" also fires R12's own case
      //     ("R12: a 404 with a kept K re-arms the probe's warning dedupe …")
      //     one poll early, off a K the reordering planted rather than one
      //     `/latest` itself ever confirmed. The ordering IS pinned — just
      //     not by case (a).
      // (2) removing `lastLatestTag = null` from the 404 arm reds (c) — S1
      //     stays kept (and un-yanked) forever.
      // (3) removing the `etag = null` reset when the kept tag changes reds
      //     (a) (the listing answers a stale 304 keyed to the old ETag and
      //     writes nothing, so S2 is never re-judged) and would equally red
      //     (b) if the fixture's own scripted answers depended on the sent
      //     ETag — they do not here, so the header assertion in (a)/(c) is
      //     what actually catches it in this fixture shape.
    });

    // R2 (fix round 2, review 143): "never yank on the evidence of a
    // repository that is not answering." Before this fix, `pollLatest`'s
    // 404 arm derived K from `newestUnyankedStable()` and the confirming
    // check's OWN 404 arm yanked it immediately — one release per poll, on no
    // evidence the repository was answering at all (a misconfigured,
    // private or deleted repo answers every endpoint 404). The reviewer
    // measured this walking a whole catalogue down to nothing, one release
    // per poll. Now the withdrawal judgment acts ONLY when the SAME poll's
    // listing itself answered 200 with a parseable body; a listing that
    // never does defers forever, harmlessly.
    describe('R2 — never yank on the evidence of a repository that is not answering', () => {
      it('every endpoint 404s for three whole polls: nothing is yanked, and the SAME newest stable is retried every time', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        // Three known stables, planted directly — the shape an already
        // populated coord.db presents to a repository that has gone dark
        // (misconfigured owner/repo, made private, or deleted).
        const mk = (tag: string, at: string): ReleaseListingRow => ({
          tag, channel: 'stable', publishedAt: Date.parse(at),
          commitSha: null, tarballUrl: null, bundleListed: true, notes: null, draft: false,
        });
        const s1 = mk('v0.0.1', '2026-08-01T00:00:00Z');
        const s2 = mk('v0.0.2', '2026-08-02T00:00:00Z');
        const s3 = mk('v0.0.3', '2026-08-03T00:00:00Z');
        store.applyReleaseListing([s1, s2, s3], 500, 'complete');
        expect(store.newestUnyankedStable()).toBe('v0.0.3');

        // Every endpoint 404s, every poll — the listing's own explicit
        // script (its unscripted default is a 500, never an answer at all).
        script = [{ status: 404 }, { status: 404 }, { status: 404 }];
        scriptLatest = [{ status: 404 }, { status: 404 }, { status: 404 }];
        scriptWithdrawn = [{ status: 404 }, { status: 404 }, { status: 404 }];
        await p.poll(1000);
        await p.poll(2000);
        await p.poll(3000);

        expect(store.releases().filter((r) => r.yanked)).toHaveLength(0);
        // Every deferred withdrawal was DISCARDED, never remembered: K was
        // never advanced off v0.0.3, so every poll's tag check asked about
        // the SAME release, never v0.0.2 or v0.0.1 (which the ungated
        // mechanism would have reached by poll 2 and poll 3 respectively).
        expect(seenWithdrawn.map((s) => s.url)).toEqual([
          '/repos/fixture-owner/fixture-repo/releases/tags/v0.0.3',
          '/repos/fixture-owner/fixture-repo/releases/tags/v0.0.3',
          '/repos/fixture-owner/fixture-repo/releases/tags/v0.0.3',
        ]);
      });

      // Mutation (measured by hand): dropping `pendingWithdrawal !== null &&
      // listing.freshOk` back to an unconditional `applyWithdrawn(now,
      // pendingWithdrawal)` inside `pollOnce` (the shape before this fix)
      // reds the case above — v0.0.3 is yanked after poll 1, v0.0.2 after
      // poll 2, v0.0.1 after poll 3, and `seenWithdrawn`'s three URLs are
      // three DIFFERENT tags rather than the same one three times.
    });

    // Fix round 1, item 5 (ruling A): N1 above still left a residual —
    // nothing ever re-judges a stable release that is withdrawn or demoted
    // while it sits OFF the listing's own window (D-3215's own shape). The
    // poller now confirms the moment `/latest` moves away from the kept tag
    // K with ONE targeted `GET /releases/tags/{K}` before anything yields.
    describe('ruling A — a withdrawn or demoted stable OFF the window is confirmed, never guessed', () => {
      it('(a) a full page of 30 newer dev prereleases; K confirmed, then /latest 404s and the tag-check 404s -> K yanked', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        // R10 (fix round 2, review 143): a THREE-component tag — the shape
        // `isIngestibleReleaseTag` admits — or the whole page parses to zero
        // rows and the listing is refused `empty-listing`, never exercising
        // any real newest-page yank judgment at all.
        const devPage = (day: number) => Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
          rel(`v0.${day}.${i + 1}`, new Date(Date.UTC(2026, 8, day, 0, i)).toISOString(), { prerelease: true }));
        const k = rel('v0.0.1', '2026-08-01T00:00:00Z');
        script = [
          { status: 200, etag: '"eL1"', body: devPage(2) },
          { status: 200, etag: '"eL2"', body: devPage(3) },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: k },
          { status: 404 },   // /latest itself gone — the bare-404 moved-away path
        ];
        scriptWithdrawn = [{ status: 404 }];   // confirms K is truly gone
        await p.poll(1000);
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false });
        // R10: the window this case's title describes is REAL — day 2's page
        // actually landed as 30 stored dev rows, not zero.
        expect(store.releases().filter((r) => r.channel === 'dev')).toHaveLength(RELEASES_PER_PAGE);
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(1);
        expect(seenWithdrawn[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases/tags/v0.0.1');
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: true });
        // Every dev release the listing wrote stays untouched by any of this
        // — day 3's fresh page (RELEASES_PER_PAGE rows) AND day 2's now-older,
        // off-window page (RELEASES_PER_PAGE rows) both survive.
        const devRows = store.releases().filter((r) => r.tag !== 'v0.0.1');
        expect(devRows).toHaveLength(RELEASES_PER_PAGE * 2);
        expect(devRows.every((r) => !r.yanked)).toBe(true);
      });

      it("(b) /latest moves to an OLDER stable S (a demotion) -> K ends channel: 'dev', not yanked, and '*' resolves to S", async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s = rel('v0.0.1', '2026-08-01T00:00:00Z');   // older — the eventual survivor
        const k = rel('v0.0.2', '2026-08-15T00:00:00Z');   // newer — the demoted one
        // Both S and K sit OFF a 30-element dev-only window on every poll —
        // the load-bearing half of this pin: it is only the CHECK's own
        // 'single' coverage, never the ordinary listing, that can touch
        // either of them, so a mutation of the check's coverage word is
        // caught here even though the general listing never runs dry.
        // R10 (fix round 2, review 143): a THREE-component tag, the shape
        // `isIngestibleReleaseTag` admits — the original four-component
        // `v0.1.${day}.${i+1}` failed it, so every page parsed to zero rows.
        const devPage = (day: number) => Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
          rel(`v0.${day}.${i + 1}`, new Date(Date.UTC(2026, 8, day, 0, i)).toISOString(), { prerelease: true }));
        script = [
          { status: 200, etag: '"eL1"', body: devPage(2) },
          { status: 200, etag: '"eL2"', body: devPage(3) },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: k },
          { status: 200, etag: '"eS2"', body: s },   // /latest moves down to the older S
        ];
        // The tag-check answers 200 — K still exists, now flagged prerelease.
        scriptWithdrawn = [{ status: 200, etag: '"eK-dev"', body: { ...k, prerelease: true } }];
        await p.poll(1000);
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: false, channel: 'stable' });
        // R10: the window is REAL — day 2's page landed as 30 stored dev rows.
        expect(store.releases().filter((r) => r.channel === 'dev')).toHaveLength(RELEASES_PER_PAGE);
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(1);
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: false, channel: 'dev' });
        // S was never named in any listing at all — only the check's own
        // 'single' upsert of K could ever have disturbed it (it must not).
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: false, channel: 'stable' });

        const eligibility: EligibilityRow[] = store.releases().map((r) => ({
          tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked,
        }));
        const input: ResolveInput = {
          currentVersion: 'v0.0.0', highestVersion: null, floorRead: 'absent',
          nodeIntent: null, fleetIntent: { channel: 'stable', pinnedTag: null, auto: 'off' },
          releases: eligibility, refusedByThisNode: new Set<string>(),
        };
        expect(resolveNodeIntent(input).desiredStable).toBe('v0.0.1');
      });

      it('(c) a NEWER /latest answer leaves K untouched, with no tag-fetch request sent at all', async () => {
        const { port } = fixture();
        const p = poller(port);
        const k1 = rel('v0.0.1', '2026-08-01T00:00:00Z');
        const k2 = rel('v0.0.2', '2026-08-15T00:00:00Z');   // strictly newer than k1
        script = [
          { status: 200, etag: '"eL1"', body: [k1] },
          { status: 200, etag: '"eL2"', body: [k2, k1] },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: k1 },
          { status: 200, etag: '"eS2"', body: k2 },
        ];
        await p.poll(1000);
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(0);
        // K advanced normally: the listing's ETag was dropped because the
        // kept tag changed (k1 -> k2), the same signal N1's own cases use.
        expect(seen[1]!.headers['if-none-match']).toBeUndefined();
      });

      it('(d) a failed tag fetch (a 500) leaves K untouched, and the very next poll retries it against the SAME K', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s = rel('v0.0.1', '2026-08-01T00:00:00Z');
        const k = rel('v0.0.2', '2026-08-15T00:00:00Z');
        script = [
          { status: 200, etag: '"eL1"', body: [k, s] },
          { status: 200, etag: '"eL2"', body: [k, s] },
          { status: 200, etag: '"eL3"', body: [s] },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: k },
          { status: 200, etag: '"eS2"', body: s },   // moved away — poll 2's check
          { status: 200, etag: '"eS3"', body: s },   // still away — poll 3's RETRY
        ];
        scriptWithdrawn = [
          { status: 500 },     // poll 2: the check itself fails
          { status: 404 },     // poll 3: retried against the SAME K, now confirmed
        ];
        await p.poll(1000);
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(1);
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: false });   // K untouched
        await p.poll(3000);
        // A failed check never advances latestEtag either — poll 3's /latest
        // request still carries K's OWN original etag ("eS1"), never S's, so
        // it cannot get a cheap 304 in S's place and re-answers in full.
        expect(seenLatest[2]!.headers['if-none-match']).toBe('"eS1"');
        expect(seenWithdrawn).toHaveLength(2);
        expect(seenWithdrawn[1]!.url).toBe(seenWithdrawn[0]!.url);   // the SAME K, retried
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: true });
      });

      it('(e) after a restart, a fresh poller derives K from the store alone and still runs the check', async () => {
        const { store, port } = fixture();
        // Simulate the pre-restart state directly on the store — K is already
        // its newest un-yanked stable release, with no poller ever having run.
        const kRow: ReleaseListingRow = {
          tag: 'v0.0.1', channel: 'stable', publishedAt: Date.parse('2026-08-01T00:00:00Z'),
          commitSha: null, tarballUrl: null, bundleListed: true, notes: null, draft: false,
        };
        store.applyReleaseListing([kRow], 500, 'complete');
        expect(store.newestUnyankedStable()).toBe('v0.0.1');

        const p = poller(port);   // a FRESH poller: lastLatestTag starts null
        script = [{ status: 200, etag: '"eL1"', body: [rel('v0.0.9', '2026-08-02T00:00:00Z', { prerelease: true })] }];
        scriptLatest = [{ status: 404 }];
        scriptWithdrawn = [{ status: 404 }];
        await p.poll(1000);
        expect(seenWithdrawn).toHaveLength(1);
        expect(seenWithdrawn[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases/tags/v0.0.1');
        expect(store.releases().find((r) => r.tag === 'v0.0.1')).toMatchObject({ yanked: true });
      });

      // R8 (fix round 2, review 143): `/releases/tags/{k}`'s 200 arm is an
      // IDENTITY check, not just a shape check. An untrusted upstream (or a
      // mirror behind CCRC_RELEASE_API_URL) answering ABOUT k with a
      // DIFFERENT tag's element must never be upserted in k's place —
      // measured by the reviewer: asked about v0.0.2, answered v0.0.7.
      it('(f) the tag-check answers 200 naming a DIFFERENT tag than K — refused as a failed check, K untouched, retried', async () => {
        const { store, port } = fixture();
        const p = poller(port);
        const s = rel('v0.0.1', '2026-08-01T00:00:00Z');
        const k = rel('v0.0.2', '2026-08-15T00:00:00Z');
        const wrongTag = rel('v0.0.7', '2026-08-20T00:00:00Z');
        script = [
          { status: 200, etag: '"eL1"', body: [k, s] },
          { status: 200, etag: '"eL2"', body: [k, s] },
          { status: 200, etag: '"eL3"', body: [s] },
        ];
        scriptLatest = [
          { status: 200, etag: '"eS1"', body: k },
          { status: 200, etag: '"eS2"', body: s },   // moved away — poll 2's check
          { status: 200, etag: '"eS3"', body: s },   // still away — poll 3's RETRY
        ];
        scriptWithdrawn = [
          { status: 200, etag: '"eWrong"', body: wrongTag },   // poll 2: answers about a DIFFERENT tag
          { status: 404 },                                     // poll 3: retried against the SAME K, now confirmed
        ];
        await p.poll(1000);
        await p.poll(2000);
        expect(seenWithdrawn).toHaveLength(1);
        // Neither the wrong tag nor K itself was disturbed by the mismatch.
        expect(store.releases().find((r) => r.tag === 'v0.0.7')).toBeUndefined();
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: false, channel: 'stable' });
        await p.poll(3000);
        // A mismatch never advances latestEtag either — poll 3's /latest
        // request still carries K's OWN original etag, exactly like any
        // other failed check.
        expect(seenLatest[2]!.headers['if-none-match']).toBe('"eS1"');
        expect(seenWithdrawn).toHaveLength(2);
        expect(seenWithdrawn[1]!.url).toBe(seenWithdrawn[0]!.url);   // the SAME K, retried
        expect(store.releases().find((r) => r.tag === 'v0.0.2')).toMatchObject({ yanked: true });
      });

      // Mutations (measured by hand, each reds a case above):
      // (1) passing a NEWER /latest tag through the moved-away comparison
      //     (dropping the `compareReleaseTags(row.tag, k) < 0` guard, or
      //     inverting it) reds (c) — a tag-fetch request fires where none
      //     should (`seenWithdrawn` is no longer empty).
      // (2) the check's 200 arm passing 'complete'/'newest-page' instead of
      //     'single' reds (b) — every OTHER known release ends yanked too.
      // (3) the check's 404 arm passing 'newest-page'/'complete' instead of
      //     'withdrawn', or naming a tag other than k, reds (a) (the wrong
      //     row, or every other row, ends yanked) and the store-level
      //     'withdrawn' pins in update-store-catalogue.test.ts directly.
      // (4) advancing `latestEtag`/`lastLatestTag` to T on a FAILED check
      //     reds (d) — the retry in poll 3 never fires (`seenWithdrawn`
      //     stays at 1), because the next `/latest` request would carry T's
      //     etag and could get a cheap 304 in its place.
      // (5) removing R8's `row.tag !== k` guard reds (f) — v0.0.7 would be
      //     upserted and K would move on as if confirmed.
    });

    // Fix round 1, review round 2, item 4: `/releases/latest` never legally
    // answers a draft or a prerelease — treated as a failed latest (warned,
    // deduped; ETag and lastLatestTag both left alone), never written, so it
    // can neither yank nor alter an existing row.
    // N3 (fix round 1, re-review round 2): the ORIGINAL version of this case
    // named a draft/prerelease under a tag that was never an existing row
    // (`v0.0.1`/`v0.0.2` beside a listed `v0.0.9`), so "does not touch an
    // existing row" was never actually exercised — a new row would simply
    // never appear, which the guard trivially achieves whether or not it
    // reads `draft`/`channel` correctly. The reviewer's measured harm was a
    // draft answer naming an EXISTING listed tag and yanking it. This case
    // now names `v0.0.9` (the one listed row) in both the draft and the
    // prerelease answer and asserts that row's own `yanked` stays `false`.
    it('a draft or prerelease answer from /releases/latest is not written, and does not touch an existing row', async () => {
      const { store, port, calls } = fixture();
      const p = poller(port);
      script = [
        { status: 200, etag: '"eL1"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
        { status: 200, etag: '"eL2"', body: [rel('v0.0.9', '2026-09-01T00:00:00Z')] },
      ];
      scriptLatest = [
        { status: 200, etag: '"eS1"', body: rel('v0.0.9', '2026-09-01T00:00:00Z', { draft: true }) },
        { status: 200, etag: '"eS2"', body: rel('v0.0.9', '2026-09-01T00:00:00Z', { prerelease: true }) },
      ];
      await p.poll(1000);
      expect(calls).toHaveLength(1);   // the listing only — the draft was never applied
      expect(store.releases()).toMatchObject([{ tag: 'v0.0.9', yanked: false, channel: 'stable' }]);
      await p.poll(2000);
      expect(calls).toHaveLength(2);   // the listing again — the prerelease was never applied either
      expect(store.releases()).toMatchObject([{ tag: 'v0.0.9', yanked: false, channel: 'stable' }]);
    });

    // Fix round 2 (N1): the "skip the latest probe when the listing answers
    // rate-limited" minor from fix round 1 is RETIRED — it depended on the
    // listing running first, which is exactly what caused the N1 regression.
    // Now the latest probe ALWAYS runs first, so a rate-limited listing no
    // longer has a prior probe result to skip against; both requests are
    // sent every poll regardless of either one's status.
    it('a rate-limited listing no longer skips the latest probe (the reordering retires that optimization)', async () => {
      const { port } = fixture();
      const p = poller(port);
      script = [{ status: 403 }];
      scriptLatest = [{ status: 404 }];
      expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'rate-limited' } });
      expect(seenLatest).toHaveLength(1);
    });

    // Mutations (measured by hand, each reds a case above):
    // (1) dropping the `pollLatest` call in `pollOnce` reds the off-page pin
    //     (the store never learns v0.0.1) and the 304/ETag case (no second
    //     `seenLatest` entry at all).
    // (2) passing 'complete' (a yanking coverage) instead of 'single' to
    //     `applyReleaseListing` for the latest row reds the off-page pin's
    //     dev-release assertion — a 'complete' listing of ONE row would mark
    //     every OTHER known release yanked = 1, since none of the 30 dev
    //     prereleases already in the store are named in it.
    // (3) `warnLatest` also setting `lastError` reds the failed-latest case's
    //     `p.state()` assertions (I2).
    // (4) `answer.status === 404` returning `warnLatest('http-404')` instead
    //     of `latestAnswered()` reds the 404 case's warn-count assertion (I2).
    // (5) advancing `latestEtag` before the status checks reds the
    //     failure-etag case (I2).
    // (6) dropping the `keepTags` exclusion (or the `lastLatestTag` update)
    //     reds the I3 case at poll 2 (yanked flips true).
    // (7) dropping the `row.draft || row.channel === 'dev'` guard reds the
    //     draft/prerelease case (`calls` would be 2 on poll 1, and the draft
    //     tag would appear in `store.releases()`).
  });

  // S1 (fix round 2, review 143): ruling 1's "every catalogue REQUEST stamps
  // the budget clock" was unmet two ways — only `pollListing` stamped
  // `requestedAt`, and `currentK()`'s `newestUnyankedStable()` read sat
  // outside any try, so a throwing store REJECTED `poll()` itself (breaking
  // its own "Never rejects" docstring) after sending only the `/latest`
  // request, with the listing never sent and `lastRequestAt()` left `null`.
  describe('S1 — every catalogue request stamps the clock, and a throwing store never rejects poll()', () => {
    it('a store whose newestUnyankedStable throws never rejects poll(), the listing still runs, and it warns once, deduped (mutation: remove the try around currentK)', async () => {
      const { port } = fixture();
      const throwingPort: CatalogueStore = {
        applyReleaseListing: (listing, now, coverage, keepTags, withdrawTag) =>
          port.applyReleaseListing(listing, now, coverage, keepTags, withdrawTag),
        newestUnyankedStable: () => { throw new Error('coord.db is locked'); },
      };
      const p = poller(throwingPort);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        // /latest defaults to 404 (unscripted) — an answer whose 404 arm
        // would normally derive K via currentK(), which throws here instead.
        await expect(p.poll(1000)).resolves.toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'http-500' } });
        expect(seenLatest, 'the probe\'s own request was sent').toHaveLength(1);
        expect(seen, 'S1: the listing still runs even though currentK() threw').toHaveLength(1);
        expect(p.lastRequestAt()).toBe(1000);
        const currentKWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('currentK threw'));
        expect(currentKWarnings).toHaveLength(1);

        // A second poll hitting the SAME throw does not warn again (dedupe,
        // the existing house style — re-armed only on a distinct message).
        await p.poll(2000);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('currentK threw'))).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });

    // Mutation (measured by hand): dropping the probe's own `stampRequest(now)`
    // call (relying solely on `pollListing`'s) is invisible to every OTHER
    // case in this file, because `pollListing` always runs immediately after
    // `pollLatest` with the SAME `now` — but it is exactly what this case
    // catches: checked SYNCHRONOUSLY, before the listing request has even
    // been dispatched (JS runs to the first genuine `await` — inside
    // `fetch()` itself — before yielding), `lastRequestAt()` can only be
    // non-null here because the PROBE's own call stamped it.
    it('the latest-release probe stamps lastRequestAt before the listing is even sent (mutation: drop the probe\'s own stampRequest call)', async () => {
      const { port } = fixture();
      scriptLatest = ['hang'];
      const p = poller(port, { timeoutMs: 300 });
      const pr = p.poll(1000);
      expect(p.lastRequestAt()).toBe(1000);
      expect(seen, 'the listing has not been sent yet').toHaveLength(0);
      await pr;   // let the probe time out and the (unscripted) listing run, so afterEach closes cleanly
    });
  });
});

describe('the catalogue lane — FleetWatcher.tick() (design §7: the CAPS_REFRESH_MS shape)', () => {
  afterEach(() => { vi.useRealTimers(); });

  function counting(): { polls: number[]; poller: CataloguePoller } {
    const polls: number[] = [];
    return {
      polls,
      poller: {
        poll: async (now: number) => { polls.push(now); return { lastOkAt: null, lastError: null }; },
        state: () => ({ lastOkAt: null, lastError: null }),
        lastRequestAt: () => null,
      },
    };
  }

  // The snapshot cache is the fixture home's, never `defaultCachePath()`
  // (the real `~/.ccrc`): a listable empty registry reaches `saveSnapshot`.
  function watcher(home: string, poller?: CataloguePoller): { w: FleetWatcher; registryDir: string } {
    const deps = { ...testDeps(home), ...(poller ? { catalogue: poller } : {}) };
    return { w: new FleetWatcher(deps, new Bus(), 2000, path.join(home, 'state-cache.json')), registryDir: deps.cfg.registryDir };
  }

  it('polls on the FIRST tick after start, then once per 30 minutes — never once a tick', async () => {
    const { polls, poller } = counting();
    const home = mkTmp('update-catalogue-lane-');
    const { w, registryDir } = watcher(home, poller);
    // Empty but LISTABLE, so the cadence is measured on ticks that run every
    // lane (the note in caps-refresh.test.ts's "asks once a minute, not once
    // a tick"); the unlistable case is the next one.
    mkdirSync(registryDir, { recursive: true });

    vi.useFakeTimers();
    await w.tick(); await w.tick(); await w.tick();
    expect(polls).toHaveLength(1);     // D-3182: lastCatalogueAt starts at 0

    // 29 minutes: a mutant that shrinks the cadence fires here.
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await w.tick();
    expect(polls).toHaveLength(1);

    // Exactly 30 minutes since the first poll: the gate is `>=`, so it fires.
    await vi.advanceTimersByTimeAsync(60_000);
    await w.tick();
    expect(polls).toHaveLength(2);
    expect(polls[1]! - polls[0]!).toBe(30 * 60_000);
  });

  // D-3198 (ruling R8): the lane reads nothing from
  // the registry, so the registry's fail-shut return must not stop it.
  it('polls on a tick whose registry will not list — the gate sits above the fail-shut return', async () => {
    const { polls, poller } = counting();
    const home = mkTmp('update-catalogue-unlistable-');
    const { w } = watcher(home, poller);   // no .cc-sessions: tick() fails shut on the registry read
    await w.tick();
    expect(polls).toHaveLength(1);
  });

  it('a watcher with no catalogue ticks without one', async () => {
    const home = mkTmp('update-catalogue-none-');
    const { w, registryDir } = watcher(home);
    mkdirSync(registryDir, { recursive: true });
    await expect(w.tick()).resolves.toBeUndefined();
  });
});

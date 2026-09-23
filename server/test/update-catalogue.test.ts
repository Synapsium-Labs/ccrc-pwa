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
  CATALOGUE_BODY_MAX_BYTES, NOTES_CAP_BYTES, NOTES_MARKER, RELEASES_PER_PAGE,
  apiBaseProblem, capNotes, createCataloguePoller, parseReleaseListing,
  type CatalogueStore, type CataloguePoller,
} from '../src/update/catalogue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { resolveNodeIntent, type EligibilityRow, type ResolveInput } from '../src/update/resolve.js';

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

  // Mutation: accepting http again (reverting to the old `DOWNLOAD_URL` regex)
  // reds the first case — measured by hand: swapping `safeDownloadUrl`'s
  // `u.protocol !== 'https:'` for the old `/^https?:\/\/\S+$/.test` accepts
  // the http case above and turns its `tarballUrl` non-null.
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

  it('a tag over 64 bytes is skipped; one at exactly 64 is kept', () => {
    const at64 = `v${'1'.repeat(59)}.0.0`;
    const at65 = `v${'1'.repeat(60)}.0.0`;
    expect(Buffer.byteLength(at64, 'utf8')).toBe(64);
    expect(Buffer.byteLength(at65, 'utf8')).toBe(65);
    const p = parseReleaseListing([
      rel(at64, '2026-09-20T10:00:00Z'),
      rel(at65, '2026-09-20T10:01:00Z'),
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual([at64]);
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
  //     check) keeps the 65-byte tag — the third case's skipped count goes
  //     from 1 to 0.
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

  it('B1/F3: a credentials-bearing base is refused with NO userinfo at all in the message — scheme and host only', () => {
    const problem = apiBaseProblem('https://user:hunter2@api.example.com');
    expect(problem).not.toBeNull();
    expect(problem).not.toMatch(/hunter2/);
    expect(problem).not.toMatch(/user:hunter2/);
    expect(problem).not.toContain('***@');   // F3: never a working URL, redacted or not
    expect(problem).toBe('apiUrl refused (base-url-credentials): https://api.example.com');
  });

  // F3 (fix round 1, review run 134): the reviewer's four inputs. Each must
  // reach the log with neither the password fragment nor a `user:`/`u:`
  // prefix off the RAW input — checked as the exact contiguous fragments the
  // input carries, never the single letter-pair `se` alone, which also
  // occurs inside the unrelated, fixed refusal words `base-url-unparseable`
  // and `base-url-insecure` and would be a false positive. Three of the four
  // fail to parse as a URL at all (the userinfo's own `/`, `?` or `#`
  // terminates the authority before an `@` is found, so `new URL` throws
  // "Invalid URL" on an unparseable host:port), so `apiBaseProblem` prints
  // the refusal word alone, no URL fragment at all.
  it('F3: none of the reviewer\'s four inputs ever put the secret, or a user-looking prefix, in the message', () => {
    const cases: [string, RegExp[]][] = [
      ['https://user:se/cret@api.example.invalid', [/se\/cret/, /user:/]],
      ['https://user:se?cret@api.example.invalid', [/se\?cret/, /user:/]],
      ['https://user:se#cret@api.example.invalid', [/se#cret/, /user:/]],
      ['u:pw@host', [/pw@/, /u:pw/]],
    ];
    for (const [raw, bad] of cases) {
      const problem = apiBaseProblem(raw);
      expect(problem, raw).not.toBeNull();
      expect(problem, raw).not.toBe(raw);         // never the raw input verbatim
      for (const rx of bad) expect(problem, `${raw} -> ${problem}`).not.toMatch(rx);
    }
    // The first three are unparseable outright (the userinfo's delimiter cuts
    // the authority before any `@`): no scheme/host suffix at all.
    expect(apiBaseProblem('https://user:se/cret@api.example.invalid')).toBe('apiUrl refused (base-url-unparseable)');
    expect(apiBaseProblem('https://user:se?cret@api.example.invalid')).toBe('apiUrl refused (base-url-unparseable)');
    expect(apiBaseProblem('https://user:se#cret@api.example.invalid')).toBe('apiUrl refused (base-url-unparseable)');
    // The fourth parses (an opaque, non-`http(s)` scheme) but names no real
    // host — hostname is '' — so the suffix is withheld too.
    expect(apiBaseProblem('u:pw@host')).toBe('apiUrl refused (base-url-insecure)');
  });
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
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const isLatest = (req.url ?? '').endsWith('/releases/latest');
      const entry = { method: req.method ?? '', url: req.url ?? '', headers: req.headers };
      (isLatest ? seenLatest : seen).push(entry);
      const queue = isLatest ? scriptLatest : script;
      const a = queue.shift() ?? (isLatest ? { status: 404 } : { status: 500, body: 'fixture: no answer scripted' });
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

  function fixture(): { store: CoordStore; port: CatalogueStore; calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage }[] } {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('update-catalogue-'), 'coord.db')));
    const calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage }[] = [];
    const port: CatalogueStore = {
      applyReleaseListing(listing, now, coverage) {
        calls.push({ listing, now, coverage });
        return store.applyReleaseListing(listing, now, coverage);
      },
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

  // F9 (fix round 1): `redirect: 'error'` on the LISTING fetch. Mutation
  // (measured by hand): removing `redirect: 'error'` from the listing's
  // `fetch(...)` call makes node's `fetch` FOLLOW the 302 instead — this
  // case reds because `seen` gets no second entry from this fixture (the
  // follow goes to `https://example.invalid/`, off this loopback server)
  // and the poll instead resolves `no-egress` (or hangs past the deadline),
  // never `redirect`.
  it('F9: a redirect on the listing is its own reason — never folded into no-egress — no row written, lastOkAt unmoved', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [{ status: 302, headers: { location: 'https://example.invalid/' } }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'redirect' } });
    expect(store.releases()).toEqual([]);
  });

  it('F9: a redirect on the latest probe only warns — never lastError, never lastOkAt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { port } = fixture();
      const p = poller(port);
      script = [{ status: 200, etag: '"eL"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
      scriptLatest = [{ status: 302, headers: { location: 'https://example.invalid/' } }];
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

    it('a 404 on the latest probe is an ANSWER, not an error — lastError stays null, lastOkAt moves with the listing', async () => {
      const { port } = fixture();
      const p = poller(port);
      script = [{ status: 200, etag: '"eL"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
      scriptLatest = [{ status: 404 }];
      expect(await p.poll(1000)).toEqual({ lastOkAt: 1000, lastError: null });
    });

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
        expect(await p.poll(2000)).toEqual({ lastOkAt: 2000, lastError: null });
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(1);
        await p.poll(3000);   // the latest answers 200 this time — re-arms the dedupe
        scriptLatest = [{ status: 500 }];
        await p.poll(4000);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('http-500'))).toHaveLength(2);
      } finally {
        warn.mockRestore();
      }
    });

    // Mutations (measured by hand, each reds a case above):
    // (1) dropping the `pollLatest` call in `pollOnce` reds the off-page pin
    //     (the store never learns v0.0.1) and the 304/ETag case (no second
    //     `seenLatest` entry at all).
    // (2) passing 'complete' (a yanking coverage) instead of 'single' to
    //     `applyReleaseListing` for the latest row reds the off-page pin's
    //     first assertion outright: a 'complete' listing of ONE row would
    //     mark every OTHER known release yanked = 1, since none of the 30
    //     dev prereleases already in the store are named in it.
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

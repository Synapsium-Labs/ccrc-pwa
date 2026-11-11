// The public-text classes (D-8181; the topology-clean ratchet's deny classes, D-190 to D-5878). L1: pure. ONE home for
// what a public tree may not say, read by two callers: `topology-clean.test.ts` (the tree, the history and the branch)
// and `publicTextVerdict` (`linking/policy.ts`, a plan's text before it is stored or sent to a tracker).
//
// This file holds NO fixtures. A class's `catches` list is made of the very tokens the class forbids (IPs, hosts,
// session ids, the canary), and `topology-clean.test.ts` excludes only itself from its walk, so a `catches` list here,
// in a scanned file, would turn the suite red on its own fixtures. The `catches` and `passes` of each class stay in
// that test, keyed by `name`, and its liveness rows assert each class through this module.
import { PRIVATE_NAMES, hitsIn, maskText, pairHits } from '../../../shared/private-names.mjs';

/** One forbidden class. Exactly one of `pattern` and `match` is set. */
export interface PublicTextClass {
  /** the slug the red output carries */
  name: string;
  /** applied per LINE; must carry the `g` flag (matchAll requires it). */
  pattern?: RegExp;
  /** a hashed vocabulary: the `#h8` of every entry a LINE of `file` matches, never text. */
  match?: (line: string, file: string) => string[];
  /** a `match` class's hits that span a line break (a phrase reflowed across two lines), reported against the first
   *  line (the tree scan's; the server check reads one text at a time and does not call it) */
  matchPair?: (prev: string, line: string, file: string) => string[];
  /** how a `match` class prints a path: a file named after an entry must not put the name into the log that reports it */
  printPath?: (file: string) => string;
  /** why this class can never return */
  why: string;
  /** lines the class does not read at all: the narrowest escape there is, and each one is argued where it is written */
  skipLine?: (line: string, file: string) => boolean;
  /** the documented placeholder vocabulary: a token this admits is not a violation. Never a file path. */
  allowed?: (token: string) => boolean;
}

/** The committed EXAMPLE session id — the one `session_01…`-shaped literal
 *  the tree may speak (`server/test/fixtures/panes/ask-user-question-real.txt`
 *  renders it; the stage-5 plan quotes it). 23 alnum after the prefix where a
 *  real id carries 22, which is why the pattern is greedy + equality here
 *  rather than the plan's `{22}` exact (D-190) — an exact-22 match would
 *  extract this example's own first 22 characters and flag the example as a
 *  leak. The run length is `{10,}` rather than `{22,}`: a TRUNCATED id, half
 *  pasted out of a log or an error message, still names the account it came
 *  from, and greedy-plus-equality keeps the committed example green either
 *  way. Nothing shorter than 10 is id-shaped enough to matter (D-201,
 *  superseding D-190's run length; the greedy+equality shape it argued for
 *  is unchanged). */
export const EXAMPLE_SESSION_ID = 'session_01EXAMPLEEXAMPLEEXAMPLE00';

/** The duckdns placeholder vocabulary (D-189 — the shipped set, not the
 *  plan's draft): `mybox`/`otherbox`/`fixture`/`subdomain` are the
 *  documentation and fixture names; `www` is DuckDNS's OWN update endpoint
 *  (`https://www.duckdns.org/update?…`), load-bearing in the shipped
 *  `deploy/systemd/ccrc-ddns.service` and pinned verbatim by
 *  `ccrc-expose.test.ts` — a service hostname, not anybody's box name.
 *  Bracket placeholders (`<sub>.duckdns.org`, `<name>.duckdns.org`) need no
 *  entry: the `>` breaks adjacency with `.duckdns.org`, so the pattern never
 *  matches them at all — pinned in `passes` below. */
const DUCKDNS_PLACEHOLDERS = new Set(['mybox', 'otherbox', 'fixture', 'subdomain', 'www']);

/** The private tracker keys whose ticket ids this public tree may not carry
 *  (D-5878, CLAUDE.md's "This repository is public" rule): a reader cannot
 *  open a private ticket, so its id is a dead pointer that also maps the
 *  private workspace. The tracker syncs each ticket to a GitHub issue, and the
 *  tree refers to ccrc work by that `#n`. A NAMED list, one key per entry, and
 *  deliberately not the general `[A-Z]{2,10}-[0-9]+` shape: measured on
 *  2026-10-19 that shape matched 2822 tokens in 409 tracked files that are no
 *  tracker's (UTF-8, SHA-256, AGPL-3, ARCH-21, OA-2, D-numbers' cousins), so it
 *  could only ship behind an allowlist, which this suite refuses. A key joins
 *  here once the tree measures zero ids under it. */
export const PRIVATE_TRACKER_KEYS: readonly string[] = ['CCRCP'];

/** The classes, in the ratchet's order. Later classes APPEND: the table is the whole registration surface. */
export const PUBLIC_TEXT_CLASSES: readonly PublicTextClass[] = [
  {
    name: 'public IPv4',
    // Any dotted quad OUTSIDE: RFC 1918 (10/8, 172.16/12, 192.168/16),
    // loopback (127/8), CGNAT (100.64/10 — Task 3 adds that range as its own
    // class; this one deliberately leaves it), the RFC 5737 documentation
    // ranges (192.0.2/24, 198.51.100/24, 203.0.113/24 — the ONLY ranges a
    // doc example may speak), and 0/8. A public address in this tree is
    // somebody's real box.
    pattern: /\b(?!(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|203\.0\.113|198\.51\.100|192\.0\.2|0)\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    why: 'a public IP names a reachable machine — examples speak RFC 5737, fixtures speak RFC 1918',
    // package-lock.json's "version"/"resolved" lines carry npm's own dotted
    // strings, none of them addresses; nothing else gets the line skip.
    skipLine: (line, file) =>
      file.endsWith('package-lock.json') &&
      (line.includes('"version"') || line.includes('"resolved"')),
  },
  {
    name: 'claude.ai session id',
    // The shape of a real session id: `session_01` + 22+ base62. Greedy so
    // the 23-character committed EXAMPLE matches WHOLE and the equality
    // below can admit it — see EXAMPLE_SESSION_ID's docstring.
    pattern: /session_01[A-Za-z0-9]{10,}/g,
    why: 'a real session id is a pointer into somebody\'s claude.ai account — only the committed EXAMPLE may appear',
    allowed: (token) => token === EXAMPLE_SESSION_ID,
  },
  {
    name: 'CGNAT tailnet IP',
    // 100.64/10 (RFC 6598) is the range tailscale hands out, so every dotted
    // quad in it names some real tailnet's box — the reference fleet's own
    // addresses lived here until Task 3 swept them. The public-IPv4 class
    // above deliberately excludes this range; this class owns it.
    pattern: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    why: 'a CGNAT 100.64/10 literal is a real tailnet box — fixtures speak 203.0.113.x, or the one documented placeholder',
    // Task 3 landed this class SCOPED to non-docs (D-193): the gitignored
    // operator file that keeps the real reach values had to exist BEFORE the
    // tree-wide sweep erased them. Task 8 wrote deploy/reference-fleet.md,
    // swept the docs corpus, and dropped the scope — the class now reaches
    // every tracked file, and no class below carries a scope any more.
    // The ONE sanctioned CGNAT literal (D-193): `_dr_ip4_global`'s whole
    // point is classifying this range, so ccrc-doctorFixture.ts's CGNAT-arm
    // fixture cannot speak 203.0.113.x — the class admits exactly one
    // obviously-synthetic placeholder instead. It is nobody's box: CGNAT
    // addresses are not publicly routable, so the leak this class prevents
    // is fleet topology, which a fixed placeholder does not carry.
    allowed: (token) => token === '100.100.1.1',
  },
  {
    name: 'tailnet name',
    // Any `<label>.ts.net` name. A tailnet DNS name locates a real box on a
    // real person's tailnet; examples speak `mybox.example.com` (the plan's
    // rpId vocabulary — a `.ts.net` placeholder would match this very ban),
    // and prose that needs the tailnet SHAPE speaks bracket forms
    // (`<tailnet>.ts.net`), which the `>` keeps out of the pattern's reach.
    // Bare `ts.net` stays legal: it is the PUBLIC SUFFIX, load-bearing in
    // webauthn.ts's PUBLIC_SUFFIX_TRAPS and every PSL discussion. The
    // reference fleet's own bare name tokens left this class for the hashed
    // one below, which says them without spelling them.
    // Case-insensitive (D-206, whole-branch review): DNS is case-blind, so an
    // upper-cased `.ts.net` name locates the same real box.
    pattern: /[a-z0-9-]+\.ts\.net/gi,
    why: 'a tailnet DNS name locates somebody\'s real box — examples speak mybox.example.com or <tailnet>.ts.net',
    // Task 4 landed this class scoped to the runtime tree (D-193's reason,
    // restated at the CGNAT class); Task 8 dropped the scope.
  },
  {
    name: 'duckdns subdomain',
    // DuckDNS names are claimed by a person — any subdomain outside the
    // placeholder vocabulary is somebody's real, resolvable box.
    // Case-insensitive (D-206, same reason as the tailnet class: DNS is
    // case-blind). The `allowed` vocabulary stays EXACT-lowercase on purpose:
    // the docs speak the canonical placeholder spelling, so a case-variant
    // placeholder is a vocabulary drift the ratchet flags, not admits.
    pattern: /[a-z0-9-]+\.duckdns\.org/gi,
    why: 'a duckdns subdomain outside the placeholder set resolves to somebody\'s real box',
    allowed: (token) => DUCKDNS_PLACEHOLDERS.has(token.replace(/\.duckdns\.org$/, '')),
  },
  {
    name: 'email address',
    // Added before the GPT-lane sources arrive: an address matches as one
    // bounded token, case-insensitively. `*` belongs to the local-part
    // vocabulary because hostile-input fixtures use it literally.
    pattern: /(?<![-A-Za-z0-9._%+*@])[-A-Za-z0-9._%+*]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![-A-Za-z0-9_@%+*]|\.[A-Za-z0-9-])/gi,
    why: 'an email address outside the documented placeholder vocabulary names a real person or account',
    allowed: (token) => {
      // Classification is case-blind so a casing change cannot evade a fixed
      // exception. These remain exact tokens, never file or domain allowlists.
      const normalized = token.toLowerCase();
      const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
      return normalized === 'noreply@anthropic.com'
        || normalized === 'git@github.com'
        // Hostile-input test syntax and third-party package metadata,
        // respectively: exact unavoidable tokens, not domain exemptions.
        || new Set([
          ['*', '@evil.com'].join(''),
          ['8080', '@evil.com'].join(''),
          ['pass', '@evil.com'].join(''),
          'i@izs.me',
        ]).has(normalized)
        // Systemd template instances are syntax, not email addresses. This
        // deliberately classifies only its unit suffix grammar, not arbitrary
        // @-bearing filenames or dotted suffixes.
        || /\.(?:service|timer|slice|socket|target|scope|path|mount|device|swap|automount)$/.test(domain)
        || domain === 'localhost'
        || /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/.test(normalized)
        || /@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:example|invalid|test|localhost)$/.test(normalized);
    },
  },
  {
    name: 'private name (hashed)',
    // The operator rule of 2026-10-12, enforced without spelling what it bans:
    // `PRIVATE_NAMES` (private-names.mjs) holds keyed hashes of the names
    // already public in this repository's history, and every line's tokens are
    // hashed the same way and compared. It replaced the two classes made only
    // of base64 literals (the fleet account labels and the operator residue),
    // whose literals decoded to the names themselves. A name that was never
    // published is not here at all — it lives in the operator's local list,
    // read by the local scan, and by the pre-push hook once this PR merges.
    // Its exemptions are argued once, in private-names.mjs: the scan applies them too.
    match: (line, file) => hitsIn(line, file, PRIVATE_NAMES),
    matchPair: (prev, line, file) => pairHits(prev, line, file, PRIVATE_NAMES),
    printPath: (file) => maskText(file, PRIVATE_NAMES),
    why: 'the operator rule of 2026-10-12: no other project, lane, host, person, ticket or commercial matter in this ' +
      'public tree; speak in project-<x>, claude-<x>, the fleet box, <projects-root>',
  },
  {
    name: 'private tracker id',
    // D-5878. A ticket id under any PRIVATE_TRACKER_KEYS key, or a link into
    // the tracker's workspace. Case-insensitive: the tracker's suggested
    // branch names spell the id in lowercase, and a branch name pasted into a
    // doc points at the same ticket. The bare key, a D-number, an ARCH-NN
    // audit id and a GitHub `#n` stay legal, pinned in `passes`.
    pattern: new RegExp(
      `\\b(?:${PRIVATE_TRACKER_KEYS.join('|')})-[0-9]+\\b|\\blinear\\.app/[A-Za-z0-9._-]+`, 'gi'),
    why: 'a private tracker ticket id or link is a pointer no reader of this public tree can open — refer to ccrc work by its GitHub #n, which the tracker syncs',
  },
];

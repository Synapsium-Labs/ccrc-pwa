// The topology-clean RATCHET (Stage 5, spec §3): the tree is owner-agnostic
// and box-agnostic, and this suite is the mechanism that keeps it so — the
// 2026-08-22 sensitive-info scan cleared these classes, and reintroduction
// ANYWHERE a `git ls-files` walk reaches (code, test, doc, fixture) is a red
// build. Each sweep task of the stage ADDS its pattern class to `FORBIDDEN`
// red-first, sweeps the tree to green, and the class can never return; the
// pre-flip re-scan is then confirmation, not the mechanism.
//
// The one subtlety spec §3 settles: a suite that spelled the forbidden tokens
// verbatim would itself publish them. So every class forbids by PATTERN —
// a shape, plus the committed placeholders the docs are allowed to speak in —
// and never names a real host, address or id. The synthetic tokens in each
// class's `catches` list live only in THIS file, which the walk excludes by
// path; rename this file and the walk scans it, its own fixtures score, and
// the suite goes loudly red until `SELF` is updated — a safe failure mode,
// left deliberately.
//
// No allowlist of files at ship — an empty allowlist IS the claim. A class's
// `allowed` predicate admits only the documented placeholder VOCABULARY
// (`mybox.duckdns.org`, the committed EXAMPLE session id), never a path. Any
// future exception must be argued into this file next to the pattern it
// excuses, not waved through in review.
//
// Mutation ceremony (measured at ship, re-measured at Task 10): plant a
// class's first `catches` token on a line of a TRACKED doc → exactly 1 red;
// revert by editing. Ship measurement 2026-08-23: 1 red (public IPv4 planted
// in README.md), suite green on revert. Task 8 re-measure (scopes dropped,
// operator-residue class added): 1 red (the residue class's first token
// planted in README.md), 30/30 on revert. Task 10 final close 2026-08-23:
// one token each of 3 classes (public IPv4, CGNAT, duckdns) planted on one
// README.md line → exactly 3 reds, one per class; 30/30 on revert.
// Whole-branch review re-measure 2026-08-23 (D-206 case flags, D-207 path
// corpus): with both gaps probed at once — a case-variant of each name class
// planted in README.md AND a tracked file NAMED after the tailnet residue —
// the pre-fix suite ran 30/30 GREEN (both blindnesses demonstrated), the
// fixed suite exactly 3 reds (tailnet content, duckdns content, tailnet
// path — one per probe), and 38/38 on revert.
// D-208 range ceremony 2026-08-24: a public IPv4 planted in README.md by one
// commit and REMOVED by the next — tip clean, history dirty, the exact state
// the tip walk cannot see. The pre-guard suite ran 39/39 GREEN on it (the
// blindness, measured rather than argued); the guarded suite ran exactly 1 red,
// `README.md:1831: 1.2.3.4` on the public-IPv4 RANGE row, with all 47 other
// rows — every tip row included — still green; 48/48 on revert.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** This suite, excluded from its own scan BY PATH — the only path-shaped
 *  exclusion the walk has, because its `catches` fixtures are forbidden
 *  tokens by design. */
const SELF = 'server/test/topology-clean.test.ts';

/** Skipped by EXTENSION, not by path: bytes that are not text. Reading a PNG
 *  as utf8 yields mojibake whose digit runs could score phantom IPs. */
// Anything whose bytes are not text. Wider than what the tree tracks today
// (only .png/.ico/.woff2/.db exist): a binary read as utf8 scores phantom
// dotted quads and duckdns-shaped runs out of compressed noise, so the first
// asset someone commits should not red the ratchet for a leak that is not
// there. The set is pinned by the exclusion row below, so widening it is a
// diff a reviewer sees rather than a quiet loosening.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm',
]);

// `git ls-files` from the repo root IS the corpus definition: every tracked
// file, nothing registered by hand — a new file needs no wiring to be
// scanned, which is what makes this a ratchet rather than a checklist.
const trackedPaths: string[] = execFileSync('git', ['ls-files', '-z'], {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
})
  .toString('utf8').split('\0').filter(Boolean);

const trackedFiles: string[] = trackedPaths
  .filter((f) => f !== SELF && !BINARY_EXT.has(path.extname(f)));

interface CorpusFile { file: string; lines: string[] }

const CORPUS: CorpusFile[] = [];
for (const file of trackedFiles) {
  let text: string;
  try {
    text = readFileSync(path.join(root, file), 'utf8');
  } catch (e) {
    // A tracked file deleted from the working tree mid-development has no
    // content to leak; anything else (EACCES, EISDIR) stays a loud throw.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw e;
  }
  CORPUS.push({ file, lines: text.split('\n') });
}

/** Every tracked PATH as its own one-line pseudo-file, fed through the same
 *  classes (D-207, whole-branch review): a tracked file NAMED after a
 *  forbidden token with clean contents evaded the contents-only walk — the
 *  name ships in every clone as loudly as the bytes do. No exclusion at all
 *  here: SELF and the binary extensions are skipped from CORPUS because their
 *  BYTES are forbidden-by-design or not text; their NAMES enjoy no such
 *  license, so even this suite's own path is scanned. */
const PATH_CORPUS: CorpusFile[] = trackedPaths.map((p) => ({ file: p, lines: [p] }));

/** ─── THE PUBLISHED HISTORY, NOT JUST THE TIP (D-208) ────────────────────────
 *
 *  Everything above walks `git ls-files`: the TIP. That is the tree as it
 *  stands, and it is NOT the whole of what a push publishes. A commit that
 *  introduces a forbidden token and a later commit that removes it leave the
 *  tip clean and the BLOB permanent — reachable from the commit that added it
 *  forever, and on GitHub from `refs/pull/N/head` and the PR's own commits
 *  view even after the branch is deleted and even after a SQUASH merge. So the
 *  tip scan can be green while the artifact this repo publishes is not.
 *
 *  Measured, which is why this is a row and not a comment asking for one: on
 *  2026-08-24 a finished 128-commit branch ran this suite 30/30 GREEN with 13
 *  of its own commits carrying residue in intermediate states — 326
 *  occurrences of one class in the first commit alone. The tip was genuinely
 *  clean, the history was not, and nothing in the tree could tell anybody. The
 *  repo had gone public that morning; the remedy for a published leak is
 *  another `filter-repo` over every ref, and this project has run two.
 *
 *  The same classes, then, over every blob the range INTRODUCES. */

/** The base this branch is measured against. `origin/main` is the answer in a
 *  clone and in CI; `$CCRC_HISTORY_BASE` overrides it where the base is
 *  elsewhere. This returns null rather than guessing, and the row below turns
 *  that null RED: a guard that quietly measures nothing is the exact failure
 *  mode this file argues against, and a shallow `actions/checkout` (the
 *  default, depth 1, where `origin/main` does not exist) is precisely how it
 *  would happen. CI therefore carries `fetch-depth: 0`, and deleting it makes
 *  this suite red instead of making it vacuous. */
function resolveBase(cwd: string): string | null {
  const candidates = [process.env.CCRC_HISTORY_BASE, 'origin/main', 'main']
    .filter((r): r is string => Boolean(r));
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        { cwd, stdio: 'pipe' });
      return ref;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Every blob introduced by `range`, as a pseudo-file keyed on the path git
 *  records for it. Intermediate states are the POINT: a blob is published by
 *  the commit that adds it, not by surviving to the tip.
 *
 *  `file` is the bare path, deliberately NOT decorated with the blob sha —
 *  every class's `scope` and `skipLine` predicate matches on it (the
 *  `package-lock.json` line skip, a `docs/` scope), and a decorated label
 *  would stop those matching and manufacture false positives the tip walk does
 *  not have. One path therefore appears once per version, which is correct. To
 *  find the commit behind a row: `git rev-list --objects <range> | grep <path>`.
 *
 *  SELF is excluded for the tip walk's reason plus one more: a HISTORICAL copy
 *  of this suite carries the same `catches` fixtures, so a range touching this
 *  file would score its own liveness tokens. */
function rangeCorpus(cwd: string, range: string): CorpusFile[] {
  const listed = execFileSync('git', ['rev-list', '--objects', range],
    { cwd, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const pathOf = new Map<string, string>();
  for (const line of listed.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) pathOf.set(line.slice(0, sp), line.slice(sp + 1));
  }
  if (pathOf.size === 0) return [];

  const checked = execFileSync('git', ['cat-file', '--batch-check'],
    { cwd, input: `${[...pathOf.keys()].join('\n')}\n`, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8');
  const blobs: string[] = [];
  for (const line of checked.split('\n')) {
    const [sha, type] = line.split(' ');
    if (type !== 'blob') continue;
    const p = pathOf.get(sha);
    if (!p || p === SELF || BINARY_EXT.has(path.extname(p))) continue;
    blobs.push(sha);
  }
  if (blobs.length === 0) return [];

  const buf = execFileSync('git', ['cat-file', '--batch'],
    { cwd, input: `${blobs.join('\n')}\n`, maxBuffer: 512 * 1024 * 1024 });
  const out: CorpusFile[] = [];
  let pos = 0;
  for (const sha of blobs) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const size = Number(buf.subarray(pos, nl).toString('utf8').split(' ')[2]);
    if (!Number.isFinite(size)) break;
    const body = buf.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    out.push({ file: pathOf.get(sha) as string, lines: body.toString('utf8').split('\n') });
  }
  return out;
}

const HISTORY_BASE: string | null = resolveBase(root);
const HISTORY_CORPUS: CorpusFile[] =
  HISTORY_BASE ? rangeCorpus(root, `${HISTORY_BASE}..HEAD`) : [];

/** One forbidden class. Later stage-5 tasks APPEND to `FORBIDDEN` — the
 *  table is the ratchet's whole registration surface. */
interface ForbiddenClass {
  /** the slug the red output carries */
  name: string;
  /** applied per LINE; must carry the `g` flag (matchAll requires it) */
  pattern: RegExp;
  /** why this class can never return */
  why: string;
  /** files the class does not (yet) reach — Tasks 3/4/5 landed scoped
   *  (`!file.startsWith('docs/')`) and Task 8 dropped every scope; the field
   *  stays for any future class that must land the same way. Absent means
   *  the whole corpus, and at ship NO class carries one. */
  scope?: (file: string) => boolean;
  /** lines the class does not read at all — the narrowest escape there is,
   *  and each one is argued where it is written */
  skipLine?: (line: string, file: string) => boolean;
  /** the documented placeholder vocabulary — a token this admits is not a
   *  violation. Never a file path. */
  allowed?: (token: string) => boolean;
  /** liveness fixtures: each must score a violation on a synthetic line —
   *  the guard on the guard, so a pattern edit that goes vacuous turns its
   *  own row red instead of the tree scan quietly green. The FIRST entry is
   *  the mutation-ceremony token. */
  catches: string[];
  /** and each of these must NOT score — the placeholders and carve-outs,
   *  pinned so a pattern edit cannot silently widen into them either */
  passes: string[];
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
const EXAMPLE_SESSION_ID = 'session_01EXAMPLEEXAMPLEEXAMPLE00';

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

/** The reference fleet's own two name tokens — its tailnet's DNS label and
 *  its server host's name — BASE64-ENCODED, spec §3's residue idiom: a
 *  pattern can say `*.ts.net` without naming anybody, but these two are
 *  concrete values a pattern cannot express, and a suite that spelled them
 *  verbatim would itself publish the strings it exists to hunt. Encoding
 *  breaks casual greppability; the values are already public-by-ruling in
 *  the retained commit-author history, so this is noise-prevention, not
 *  secrecy. Decoded once, fed to the pattern and the liveness fixtures. */
const TAILNET_RESIDUE: string[] = ['dGFpbDMzZjExYw==', 'Y2xhdWRlLXJj']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'));

/** The reference fleet's four real account labels plus its operator's old
 *  employer name (Task 5, spec §5) — BASE64-ENCODED, the same residue idiom
 *  as TAILNET_RESIDUE above and for the same reason: these are concrete
 *  values no pattern can express without spelling them, and a suite that
 *  spelled them verbatim would itself publish the strings it exists to hunt.
 *  The fixture vocabulary that replaced them (`team·max`, `alt·max`,
 *  `team·shared`, `lab·dev0`, and `orchard-api` for the project name) is
 *  pinned in `passes` below so the class cannot silently widen into its own
 *  replacements. */
const ROSTER_RESIDUE: string[] = [
  'ZXhwb8K3bWF4', 'Z21haWzCt21heA==', 'ZXhwb8K3dGVhbQ==', 'c3luwrdkZXYw', 'ZXhwb3BsYXRmb3Jt',
].map((b) => Buffer.from(b, 'base64').toString('utf8'));

/** The residue no pattern can express (Task 8, spec §3): the operator's
 *  username, the two SSH key names, the Hetzner volume id, the GitHub
 *  handle and the pre-transfer owner org — BASE64-ENCODED for the same
 *  reason as the two residue lists above: a suite that spelled them
 *  verbatim would itself publish the strings it exists to hunt. Encoding
 *  breaks casual greppability, while the values themselves are already
 *  public-by-ruling in the retained commit-author history, so this is
 *  noise-prevention, not secrecy. The owner-org token joins NOW rather
 *  than post-transfer: PR #93 already flipped `CCRC_RELEASE_OWNER`, and
 *  the tree measured zero occurrences at ship — the ban costs nothing and
 *  a transfer-window reintroduction is exactly what it exists to catch. */
const OPERATOR_RESIDUE: string[] = [
  'bWZhc3RvdmV0cw==', 'b3BlbmNsYXctaGV0em5lcg==', 'b3BlbmNsYXctcmM=',
  'SENfVm9sdW1lXzEwNTc1MTQ3MA==', 'MGJMb00=', 'RXhwb1BsYXRmb3JtLUx0ZA==',
].map((b) => Buffer.from(b, 'base64').toString('utf8'));

const FORBIDDEN: ForbiddenClass[] = [
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
    catches: ['1.2.3.4', '100.200.0.1', '172.32.0.1'],
    passes: ['203.0.113.7', '198.51.100.7', '192.0.2.1', '10.1.2.3', '127.0.0.1',
      '192.168.7.7', '172.31.255.1', '100.100.1.1', '0.0.0.0'],
  },
  {
    name: 'claude.ai session id',
    // The shape of a real session id: `session_01` + 22+ base62. Greedy so
    // the 23-character committed EXAMPLE matches WHOLE and the equality
    // below can admit it — see EXAMPLE_SESSION_ID's docstring.
    pattern: /session_01[A-Za-z0-9]{10,}/g,
    why: 'a real session id is a pointer into somebody\'s claude.ai account — only the committed EXAMPLE may appear',
    allowed: (token) => token === EXAMPLE_SESSION_ID,
    // Constructed, not spelled: a verbatim 24-char id-shaped literal in this
    // file would be exactly the noise the suite exists to prevent.
    catches: ['session_01' + 'A'.repeat(22)],
    passes: [EXAMPLE_SESSION_ID],
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
    // point is classifying this range, so ccrc-doctor.test.ts's CGNAT-arm
    // fixture cannot speak 203.0.113.x — the class admits exactly one
    // obviously-synthetic placeholder instead. It is nobody's box: CGNAT
    // addresses are not publicly routable, so the leak this class prevents
    // is fleet topology, which a fixed placeholder does not carry.
    allowed: (token) => token === '100.100.1.1',
    catches: ['100.64.7.7', '100.127.3.4', '100.100.1.2'],
    passes: ['100.100.1.1', '100.63.0.1', '100.128.0.1', '203.0.113.7', '10.64.0.1'],
  },
  {
    name: 'tailnet name',
    // Any `<label>.ts.net` name plus the reference fleet's two bare tokens
    // (TAILNET_RESIDUE — base64-argued above). A tailnet DNS name locates a
    // real box on a real person's tailnet; examples speak `mybox.example.com`
    // (the plan's rpId vocabulary — a `.ts.net` placeholder would match this
    // very ban), and prose that needs the tailnet SHAPE speaks bracket forms
    // (`<tailnet>.ts.net`), which the `>` keeps out of the pattern's reach.
    // Bare `ts.net` stays legal: it is the PUBLIC SUFFIX, load-bearing in
    // webauthn.ts's PUBLIC_SUFFIX_TRAPS and every PSL discussion.
    // Case-insensitive (D-206, whole-branch review): DNS is case-blind, so a
    // capitalised residue token or an upper-cased `.ts.net` name locates the
    // same real box — the roster/operator classes already carried `i`, and
    // this class landing without it admitted every casing but lowercase.
    pattern: new RegExp(`[a-z0-9-]+\\.ts\\.net|${TAILNET_RESIDUE.join('|')}`, 'gi'),
    why: 'a tailnet DNS name or the reference fleet\'s own name tokens locate somebody\'s real box',
    // Task 4 landed this class scoped to the runtime tree (D-193's reason,
    // restated at the CGNAT class); Task 8 dropped the scope.
    catches: ['fixture-box.ts.net', TAILNET_RESIDUE[0]!, TAILNET_RESIDUE[1]!,
      'Fixture-Box.TS.NET', TAILNET_RESIDUE[1]!.toUpperCase()],
    passes: ['mybox.example.com', 'ts.net', '*.ts.net', '<tailnet>.ts.net',
      '<other-box>.<tailnet>.ts.net', 'tailscale.net'],
  },
  {
    name: 'fleet account label',
    // The reference fleet's four real account labels and the old employer
    // name (ROSTER_RESIDUE — base64-argued above), case-insensitive: the
    // employer token has appeared capitalised, hyphen-suffixed and inside
    // project names, and every casing locates the same real organisation.
    // A label names a person's or a company's account; fixtures speak the
    // `team·…` vocabulary instead.
    pattern: new RegExp(ROSTER_RESIDUE.join('|'), 'gi'),
    why: 'a real account label or the old employer name ties the tree to one operator\'s fleet — fixtures speak team·…',
    // Task 5 landed this class scoped exactly as Task 3's was (D-193's
    // reason, restated at the CGNAT class); Task 8 dropped the scope.
    catches: [...ROSTER_RESIDUE, ROSTER_RESIDUE[4]!.toUpperCase()],
    passes: ['team·max', 'alt·max', 'team·shared', 'lab·dev0', 'orchard-api',
      // `gpt` keeps its literal roster id: ccd's Codex overflow lane is keyed
      // on it, so it is a real identifier and not a name anyone chose.
      'gpt', 'claude', 'claude-corp'],
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
    catches: ['realbox.duckdns.org', 'RealBox.DuckDNS.org'],
    passes: ['mybox.duckdns.org', 'otherbox.duckdns.org', 'fixture.duckdns.org',
      'subdomain.duckdns.org', 'www.duckdns.org', '<sub>.duckdns.org', '<name>.duckdns.org'],
  },
  {
    name: 'operator residue',
    // The six concrete tokens of OPERATOR_RESIDUE (base64-argued above),
    // case-insensitive: the handle has appeared in repo slugs and the org
    // token capitalised. Docs and fixtures speak the role vocabulary
    // instead: `you@<server-host>`, `/home/you`, `/srv/projects`,
    // `~/.ssh/<your-key>`, `example-org/example-repo`. The old monorepo
    // name is NOT in this class — it survives in agent whitelist fixtures
    // and hundreds of historical plan anchors, and names a repository, not
    // a reachable box; the class bans what locates or logs into one.
    pattern: new RegExp(OPERATOR_RESIDUE.join('|'), 'gi'),
    why: 'the operator\'s username, key names, volume id, GitHub handle or the pre-transfer owner org ties the tree to the reference fleet — docs speak roles',
    catches: [...OPERATOR_RESIDUE, OPERATOR_RESIDUE[0]!.toUpperCase()],
    passes: ['you@<server-host>', '/home/you', '/srv/projects', '~/.ssh/<your-key>',
      'example-org/example-repo', 'Synapsium-Labs', 'openclaw'],
  },
];

/** The scan: every violation as `file:line: token` — when a sweep task lands
 *  its class red-first, this list IS the work-list. The corpus parameter
 *  exists for the liveness rows below: `scoresOn` proves a PATTERN is alive,
 *  but only a call through THIS function proves the scan is — a neutered
 *  `violationsOf` returns `[]` and every tree test stays green, so each class
 *  pins it against a one-file synthetic corpus. */
function violationsOf(cls: ForbiddenClass, corpus: CorpusFile[] = CORPUS): string[] {
  const out: string[] = [];
  for (const { file, lines } of corpus) {
    if (cls.scope && !cls.scope(file)) continue;
    lines.forEach((line, i) => {
      if (cls.skipLine?.(line, file)) return;
      for (const m of line.matchAll(cls.pattern)) {
        if (cls.allowed?.(m[0])) continue;
        out.push(`${file}:${i + 1}: ${m[0]}`);
      }
    });
  }
  return out;
}

/** What a class would say about one synthetic line — the liveness harness. */
function scoresOn(cls: ForbiddenClass, token: string): number {
  return [...`a line carrying ${token} in prose`.matchAll(cls.pattern)]
    .filter((m) => !cls.allowed?.(m[0])).length;
}

describe('the corpus this walks', () => {
  it('actually walked the tree — a scan over an empty list passes everything', () => {
    // The single-definition idiom: a moved root or a broken `git ls-files`
    // must turn THIS red rather than silently disarm every class below.
    expect(CORPUS.length).toBeGreaterThan(400);
    const files = CORPUS.map((c) => c.file);
    for (const f of ['README.md', 'CLAUDE.md', 'ccd/ccrc', 'server/src/index.ts',
      'deploy/deploy.sh', 'docs/superpowers/specs/2026-08-22-stage5-oss-polish-design.md',
      'server/test/fixtures/panes/ask-user-question-real.txt']) {
      expect(files, f).toContain(f);
    }
  });

  it('every class states a remedy a stranger can act on', () => {
    // `why` is rendered into the failure message, so it is the entire
    // instruction someone gets at 2am when the ratchet reds on their branch.
    // A class added with `why: 'no'` is a class nobody can clear.
    for (const cls of FORBIDDEN) {
      expect(cls.why.length, `${cls.name}'s \`why\` is too short to act on`).toBeGreaterThan(30);
    }
    // …and no two classes share one. A `why` copied from the row above is how
    // a class ends up telling somebody to fix the wrong thing.
    const whys = FORBIDDEN.map((c) => c.why);
    expect(new Set(whys).size, 'two classes share a `why`').toBe(whys.length);
  });

  it('excludes exactly this file and the binary extensions, nothing else', () => {
    const files = CORPUS.map((c) => c.file);
    expect(files).not.toContain(SELF);
    for (const f of files) {
      expect(BINARY_EXT.has(path.extname(f)), `${f} is binary-extensioned yet scanned`).toBe(false);
    }
    // …and the exclusion is not covering for a rename: the file this suite
    // excludes is the file it lives in.
    expect(path.relative(root, fileURLToPath(import.meta.url))).toBe(SELF);
  });

  it('the path corpus reaches even the files whose CONTENTS are excluded', () => {
    // D-207: the content walk's two escapes (SELF, binary extensions) are
    // byte-arguments, so the path corpus must cover MORE than CORPUS does —
    // this suite's own path included.
    const paths = PATH_CORPUS.map((c) => c.file);
    expect(paths).toContain(SELF);
    expect(paths.length).toBeGreaterThanOrEqual(CORPUS.length);
  });
});

describe('the published history, not just the tip', () => {
  it('resolved a base to measure against — a missing one is RED, never vacuous', () => {
    expect(HISTORY_BASE,
      'no $CCRC_HISTORY_BASE, origin/main or main resolved: a shallow checkout cannot guard history, and this refuses to report a range nobody measured')
      .not.toBeNull();
  });

  it('demonstrates the blindness it closes — a clean tip over a dirty history', () => {
    // The guard on the guard, and the only row that proves the two walks are
    // DIFFERENT. A throwaway repo whose final tree is clean and whose middle
    // commit is not: the tip walk passes it, the range walk must not. If these
    // two ever agree, this file has stopped measuring anything.
    //
    // Fixture HOME discipline: git runs with both config scopes pointed at
    // /dev/null and identity supplied per-process, so this can neither read
    // nor write the developer's real git config.
// RESOLVED — see tmpHelpers' mkTmp: on macOS the temp root lives under a
// symlink (/var -> /private/var), and ccd resolves paths deliberately, so an
// unresolved fixture path compares two spellings of one directory.
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccrc-hist-')));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
      };
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: tmp, stdio: 'pipe', env });
      };
      const stage = (body: string): void => {
        writeFileSync(path.join(tmp, 'f.md'), body);
        git('add', '-A');
      };
      git('init', '-q', '-b', 'main');
      stage('nothing here\n');
      git('commit', '-qm', 'base');
      const planted = FORBIDDEN[0].catches[0];
      stage(`a line carrying ${planted} in prose\n`);
      git('commit', '-qm', 'dirty middle');
      stage('nothing here again\n');
      git('commit', '-qm', 'clean tip');

      // The tip walk over that repo: blind, by construction.
      const tip: CorpusFile[] = [{
        file: 'f.md',
        lines: readFileSync(path.join(tmp, 'f.md'), 'utf8').split('\n'),
      }];
      expect(violationsOf(FORBIDDEN[0], tip),
        'the tip walk should see nothing here — that blindness IS the gap').toEqual([]);

      // The range walk over the same three commits: not blind.
      const found = violationsOf(FORBIDDEN[0], rangeCorpus(tmp, 'main~2..main'));
      expect(found.length, `the range walk missed the planted ${planted}`).toBeGreaterThan(0);
      expect(found.join('\n')).toContain(planted);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

for (const cls of FORBIDDEN) {
  describe(`forbidden class: ${cls.name}`, () => {
    it(`the pattern is alive — it scores each synthetic token (${cls.why})`, () => {
      for (const token of cls.catches) {
        expect(scoresOn(cls, token), `pattern went vacuous for: ${token}`).toBeGreaterThan(0);
      }
    });

    it('and admits exactly the documented placeholders', () => {
      for (const token of cls.passes) {
        expect(scoresOn(cls, token), `placeholder now scores: ${token}`).toBe(0);
      }
    });

    it('the scan itself is alive — a synthetic corpus yields the file:line: token row', () => {
      // Through violationsOf, not scoresOn: this is the row that goes red if
      // the tree scan is neutered (the push deleted, an early return added)
      // while every pattern stays healthy. It also pins the work-list format
      // sweep tasks read.
      // The synthetic file sits under server/ so it stays inside any scope
      // a class could carry — while Tasks 3/4/5 ran scoped, both the
      // exclusion-scoped classes (CGNAT) and the inclusion-scoped one
      // (tailnet name) reached it, so a scope predicate could not quietly
      // blind this liveness row; no class is scoped since Task 8.
      const synthetic: CorpusFile[] = [
        { file: 'server/synthetic.md', lines: [`a line carrying ${cls.catches[0]} in prose`] },
      ];
      expect(violationsOf(cls, synthetic)).toEqual([`server/synthetic.md:1: ${cls.catches[0]}`]);
    });

    it('nothing in the tree speaks it', () => {
      expect(violationsOf(cls)).toEqual([]);
    });

    it('and nothing this branch ADDS speaks it, at any commit in the range', () => {
      // D-208: the rows above pass over a branch whose MIDDLE commits are
      // dirty. This one reads every blob `<base>..HEAD` introduces, so a token
      // added and later removed still reds the branch that would publish it.
      expect(violationsOf(cls, HISTORY_CORPUS)).toEqual([]);
    });

    it('and no tracked path is NAMED after it', () => {
      // D-207: the pseudo-line rides the same violationsOf machinery as the
      // content scan, so the liveness rows above cover this walk too — a
      // neutered violationsOf reds them before it could quietly green this.
      expect(violationsOf(cls, PATH_CORPUS)).toEqual([]);
    });
  });
}

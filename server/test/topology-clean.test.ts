// ── the ratchet: the reference deployment cannot come back ────────────────
//
// Stage 5, Task 1. The operator's ruling on the docs sweep was that the bar is
// "verified, not asserted" — a read-through by one person, once, is not a bar.
// This suite is the mechanism: it walks every git-tracked file and FAILS on
// reintroduction of the reference box's identity, anywhere — source, test,
// fixture, doc, comment. The pre-flip scan then becomes CONFIRMATION of a
// property already held, rather than the only thing holding it.
//
// ── why the classes are patterns and not a word list ──────────────────────
// A suite that spelled the forbidden values verbatim would itself publish
// them, and would be the single most greppable file in a public repo. So each
// class is expressed as a SHAPE wherever a shape can say it: any CGNAT
// address, any tailnet DNS name, any host-mount path. What a shape genuinely
// cannot express (a username, two ssh key names) will ride base64-encoded when
// its sweep lands, with a comment saying exactly why — that breaks casual
// greppability, and the values are already public in the retained commit-author
// history, so it is noise-prevention rather than secrecy.
//
// ── growth ────────────────────────────────────────────────────────────────
// It lands with the classes the 2026-08-22 scan already cleared. Each sweep
// task appends ITS class here in the same commit that clears it, so the suite
// only ever ratchets. There is no allowlist: an empty allowlist IS the claim.
// A future exception must be argued into this file next to the pattern it
// excuses, where a reviewer sees it.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'server/test/topology-clean.test.ts';

/** Extensions whose bytes are not text; scanning them yields noise, not findings. */
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|otf|db|sqlite|pdf|zip|gz|tgz|wasm)$/i;

/** Every git-tracked file, read once. `-z` because a path may contain anything. */
function trackedFiles(): string[] {
  return execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean).filter((f) => !BINARY.test(f) && f !== SELF);
}

interface Rule {
  name: string;
  pattern: RegExp;
  why: string;
  /** Lines a rule deliberately does not judge, with the reason stated. */
  skipLine?: (line: string, file: string) => boolean;
  skipFile?: (file: string) => boolean;
}

const FORBIDDEN: Rule[] = [
  {
    name: 'public IPv4 literal',
    // Every routable address EXCEPT: RFC 1918, loopback, 0.x, CGNAT (100.64/10
    // — its own class, added by the sweep that clears it), and the three RFC
    // 5737 documentation ranges, which are the replacement vocabulary.
    pattern: /\b(?!(?:10|127|0|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|203\.0\.113|198\.51\.100|192\.0\.2)\.)(?:\d{1,3}\.){3}\d{1,3}\b/,
    why: 'a routable address in a public repo is either this box or someone else\'s; documentation IPs are 203.0.113.x / 198.51.100.x / 192.0.2.x',
    // A lockfile's "version": "1.2.3" and its resolved URLs are semver and
    // registry paths that happen to read as dotted quads. Judging them would
    // make every dependency bump a topology finding.
    skipLine: (l, f) => /package-lock\.json$/.test(f) && /"(version|resolved|integrity)"/.test(l),
  },
  {
    name: 'claude.ai session id',
    // The one committed EXAMPLE is the fixture every pane parser is pinned
    // against; any OTHER id of that shape is a real session someone opened.
    pattern: /session_01(?!EXAMPLEEXAMPLEEXAMPLE00\b)[A-Za-z0-9]{10,}/,
    why: 'a real claude.ai session id; the only permitted one is session_01EXAMPLEEXAMPLEEXAMPLE00',
  },
  {
    name: 'DuckDNS hostname',
    // `www.duckdns.org` is the provider's own API host and is not a name of
    // anyone's box.
    pattern: /\b(?!(?:mybox|otherbox|newbox|fixture|ccrc-fixture|subdomain|www)\b)[a-z0-9][a-z0-9-]*\.duckdns\.org/,
    why: 'a real DuckDNS name is a live box; examples use mybox / otherbox / fixture',
  },
];

describe('topology-clean: the reference deployment stays out of the public tree', () => {
  // Read once; every rule scans the same in-memory corpus.
  const corpus = trackedFiles().map((f) => {
    let text = '';
    try { text = readFileSync(join(REPO, f), 'utf8'); } catch { text = ''; }
    return { file: f, lines: text.split('\n') };
  });

  it('actually walked the tree — a scan over an empty corpus passes everything', () => {
    // The failure this prevents: `git ls-files` returning nothing (wrong cwd, a
    // detached worktree) and every assertion below passing vacuously.
    expect(corpus.length).toBeGreaterThan(300);
    expect(corpus.some((c) => c.file === 'README.md')).toBe(true);
    expect(corpus.some((c) => c.file === 'ccd/ccrc')).toBe(true);
  });

  it.each(FORBIDDEN.map((r) => [r.name, r] as const))('%s appears nowhere', (_name, rule) => {
    const hits: string[] = [];
    for (const { file, lines } of corpus) {
      if (rule.skipFile?.(file)) continue;
      lines.forEach((line, i) => {
        if (rule.skipLine?.(line, file)) return;
        const m = rule.pattern.exec(line);
        if (m) hits.push(`${file}:${i + 1}: …${m[0]}…`);
      });
    }
    expect(hits, `${rule.why}\n${hits.slice(0, 20).join('\n')}`).toEqual([]);
  });

  it('every rule states why, so a red build explains itself', () => {
    // A reader who trips this suite is usually not the person who wrote the
    // rule. The `why` is the remedy.
    for (const r of FORBIDDEN) {
      expect(r.why.length, `${r.name} has no usable explanation`).toBeGreaterThan(30);
    }
  });

  it('carries no allowlist — an empty allowlist IS the claim', () => {
    // If an exception is ever needed it belongs beside the pattern it excuses,
    // as a `skipLine`/`skipFile` with a stated reason, not in a list of paths
    // that quietly grows.
    const self = readFileSync(join(REPO, SELF), 'utf8');
    expect(self).not.toMatch(/^const ALLOW(LIST|ED)/m);
  });
});

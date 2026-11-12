// `ccrc doctor`'s `sigstore-root` check (D-8388): the age of the Sigstore trusted root the tree's provenance verifier
// reads, `deploy/sigstore-trusted-root.jsonl`. Driven sourced, against a fixture tree whose `ccd/` holds the checks file
// (a link, so `CCRC_HERE` resolves inside the fixture) and whose `deploy/` holds a verifier and a root this file writes,
// dated from the moment the case runs. No case reads the vendored root against the clock: its age is a fact about
// the day the suite runs, not about the code.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { REPO, CHECKS_SRC, BASH, shq, tableNames, type Result } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();

const DAY_S = 86_400;
const VENDORED = join(REPO, 'deploy', 'sigstore-trusted-root.jsonl');

/** The limit, read from the checks file itself, so no case types it a second time. */
const MAX_DAYS = ((): number => {
  const m = /^DR_SIGSTORE_ROOT_MAX_DAYS=(\d+)$/m.exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error('ccd/ccrc-doctor-checks no longer declares DR_SIGSTORE_ROOT_MAX_DAYS=<days>');
  return Number(m[1]);
})();

/** ISO-8601 the way the real root writes it, `days` ago (a minute more, so the whole-day count is exact). */
const isoDaysAgo = (days: number, fraction = false): string => {
  const iso = new Date(Date.now() - days * DAY_S * 1000 - 60_000).toISOString();
  return fraction ? iso : iso.replace(/\.\d+Z$/, 'Z');
};

/** Two TrustedRoot lines in the shape `gh attestation trusted-root` prints, keys valid from the given starts. */
const rootLines = (starts: string[][]): string => starts.map((s) => JSON.stringify({
  mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
  certificateAuthorities: s.map((start, i) => ({ uri: `https://ca-${i}.example`, validFor: i === 0 ? { start, end: start } : { start } })),
  timestampAuthorities: [{ uri: 'https://tsa.example', validFor: { start: s[0] } }],
})).join('\n') + '\n';

type Root = { text: string } | { dir: true } | { absent: true } | { vendored: true };

/** A fixture tree with the checks file in `ccd/`, and in `deploy/` a verifier (unless `verifier: false`) and the root. */
const tree = (root: Root, o: { verifier?: boolean } = {}): string => {
  const home = mkTmp('ccrc-doctor-sigroot-');
  const t = join(home, 'ccrc');
  mkdirSync(join(t, 'ccd'), { recursive: true });
  mkdirSync(join(t, 'deploy'), { recursive: true });
  symlinkSync(CHECKS_SRC, join(t, 'ccd', 'ccrc-doctor-checks'));
  if (o.verifier !== false) writeFileSync(join(t, 'deploy', 'verify-provenance.mjs'), '// fixture verifier\n');
  const p = join(t, 'deploy', 'sigstore-trusted-root.jsonl');
  if ('text' in root) writeFileSync(p, root.text);
  else if ('dir' in root) mkdirSync(p);
  else if ('vendored' in root) symlinkSync(VENDORED, p);
  return home;
};

const run = (home: string): Result => {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _check_sigstore-root`],
    { env: { HOME: home, PATH: process.env.PATH ?? '', LC_ALL: 'C' }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const lines = (s: string): string[] => s.split('\n').filter(Boolean);
const REMEDY = /^ {2}remedy: refresh deploy\/sigstore-trusted-root\.jsonl from the Sigstore TUF root \(gh attestation trusted-root > deploy\/sigstore-trusted-root\.jsonl\) in a release PR/;

describe('ccrc doctor: sigstore-root (D-8388)', () => {
  it('is in the table once, right after provenance', () => {
    const names = tableNames();
    expect(names.filter((n) => n === 'sigstore-root')).toHaveLength(1);
    expect(names[names.indexOf('provenance') + 1]).toBe('sigstore-root');
  });

  it('the limit is longer than the longest gap between key rotations the vendored root records in its last three years, so a root refreshed after a rotation does not warn', () => {
    // The check reads the newest start of ANY key, so what a refreshed root ages through is the gap between
    // consecutive starts over the whole file. Before GitHub's own authorities joined the file (2023) the public-good
    // keys alone went more than a year between starts; the window is the cadence the limit was chosen against.
    const starts = new Set<number>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v === null || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      const vf = o['validFor'] as { start?: unknown } | undefined;
      if (typeof vf?.start === 'string') starts.add(Date.parse(vf.start));
      Object.values(o).forEach(walk);
    };
    for (const l of lines(readFileSync(VENDORED, 'utf8'))) walk(JSON.parse(l));
    const sorted = [...starts].sort((a, b) => a - b);
    const newest = sorted[sorted.length - 1]!;
    const recent = sorted.filter((t) => t >= newest - 3 * 365 * DAY_S * 1000);
    const gaps = recent.slice(1).map((t, i) => (t - recent[i]!) / (DAY_S * 1000));
    expect(gaps.length).toBeGreaterThan(2);
    expect(MAX_DAYS).toBeGreaterThan(Math.max(...gaps));
  });

  it('a fresh root PASSes, naming its newest key\'s date and age', () => {
    const r = run(tree({ text: rootLines([[isoDaysAgo(900), isoDaysAgo(400)], [isoDaysAgo(500), isoDaysAgo(12)]]) }));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const day = isoDaysAgo(12).slice(0, 10);
    expect(lines(r.stdout)).toEqual([
      `PASS sigstore-root: the vendored Sigstore trusted root's newest key became valid on ${day}, 12 days ago (limit ${MAX_DAYS} days)`,
    ]);
  });

  it('one day inside the limit PASSes; one day past it WARNs', () => {
    expect(run(tree({ text: rootLines([[isoDaysAgo(MAX_DAYS - 1)]]) })).code).toBe(0);
    expect(run(tree({ text: rootLines([[isoDaysAgo(MAX_DAYS + 1)]]) })).code).toBe(2);
  });

  it('a stale root WARNs `stale`, with the refresh as its remedy', () => {
    const r = run(tree({ text: rootLines([[isoDaysAgo(MAX_DAYS + 40, true), isoDaysAgo(MAX_DAYS + 30)]]) }));
    expect(r.code, r.stdout + r.stderr).toBe(2);
    const [verdict, remedy, ...rest] = lines(r.stdout);
    expect(verdict).toBe(`WARN sigstore-root: stale — the vendored Sigstore trusted root's newest key became valid on ${isoDaysAgo(MAX_DAYS + 30).slice(0, 10)}, `
      + `${MAX_DAYS + 30} days ago, over the ${MAX_DAYS}-day limit: a key Sigstore has rotated in since is likely missing from it, and ccrc update refuses a release signed with such a key`);
    expect(remedy).toMatch(REMEDY);
    expect(remedy).toContain('CCRC_SIGSTORE_TRUSTED_ROOT');
    expect(rest).toEqual([]);
  });

  it('reads the fractional-second spelling the vendored root uses for some keys', () => {
    const r = run(tree({ text: rootLines([[isoDaysAgo(30, true)]]) }));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('30 days ago');
  });

  it.each([
    ['absent', { absent: true } as Root, 'is not a readable regular file'],
    ['a directory', { dir: true } as Root, 'is not a readable regular file'],
    ['not JSON', { text: 'not json\n' } as Root, 'does not parse as JSON lines holding a key\'s validity start'],
    ['JSON with no validity start', { text: '{"mediaType":"x","certificateAuthorities":[{"uri":"u"}]}\n' } as Root, 'does not parse as JSON lines holding a key\'s validity start'],
    ['a start that is no date', { text: rootLines([['yesterday']]) } as Root, 'does not parse as JSON lines holding a key\'s validity start'],
    ['empty', { text: '' } as Root, 'does not parse as JSON lines holding a key\'s validity start'],
  ])('an unreadable root (%s) WARNs `unreadable`, never PASS, never `stale`', (_label, root, why) => {
    const home = tree(root);
    const r = run(home);
    expect(r.code, r.stdout + r.stderr).toBe(2);
    const [verdict, remedy] = lines(r.stdout);
    expect(verdict).toBe(`WARN sigstore-root: unreadable — the vendored Sigstore trusted root ~/ccrc/deploy/sigstore-trusted-root.jsonl ${why}, `
      + 'so its age was not measured and ccrc update cannot verify a release against it');
    expect(remedy).toMatch(REMEDY);
    expect(r.stdout).not.toContain(home);
  });

  it('SKIPs a tree that ships no provenance verifier: nothing there reads a root', () => {
    const r = run(tree({ text: rootLines([[isoDaysAgo(MAX_DAYS + 30)]]) }, { verifier: false }));
    expect(r.code).toBe(3);
    expect(lines(r.stdout)).toEqual([
      'SKIP sigstore-root: this tree ships no provenance verifier (~/ccrc/deploy/verify-provenance.mjs), so no Sigstore trusted root is read here',
    ]);
  });

  it('the vendored root parses: whatever its age today, it is never `unreadable`', () => {
    const r = run(tree({ vendored: true }));
    expect([0, 2]).toContain(r.code);
    expect(r.stdout).toMatch(/^(PASS sigstore-root: the vendored|WARN sigstore-root: stale —)/);
  });
});

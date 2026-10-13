// Path identity W1a (spec §2.3): every `readRegistry(` and
// `readRegistryMeasured(` call in server/src is classified by what it does
// with a REFUSED row: a listed `.uuid` whose id is not a registry id.
// `readRegistryMeasured` names such a row in `refused` and leaves it out of
// `records`. The classification is a comment tag, `[registry-refused:<word>]`,
// within the three lines above the call. The suite goes red on any of these:
// - a new call with no tag;
// - a tag with no call;
// - a word outside the vocabulary;
// - a site that moves to another function or route.
//
// `unplaced` describes no behaviour. It marks a caller whose handling of a
// refused row is not built yet. Later tasks of this wave replace each one
// with its placed word and pin the behaviour, and the last of them leaves
// none. `wrapper` is reserved for `readRegistry`'s own read.
//
// Tag comments in server/src carry no digit. registry.test.ts's census-claim
// parser joins every comment line of a file and reads a number followed,
// within forty characters, by a `[registry-read-census:*]` tag. A digit in a
// tag line could create or hide such a claim.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The census vocabulary. */
const WORDS: readonly string[] = [
  'holds', 'refuses', 'gated', 'omits', 'stale', 'reports', 'tests-only', 'knownId', 'raw-name', 'wrapper', 'unplaced',
];

const TAG = /\[registry-refused:([A-Za-z-]+)\]/;
const TAGS = /\[registry-refused:[A-Za-z-]+\]/g;
const READER_CALL = /\b(readRegistryMeasured|readRegistry)\s*\(/g;

/** The scope a call is classified under: the nearest line above it, the call's own line
 *  included, that registers a route or declares a function, an async arrow or an async
 *  class method. Matched on `codeOnly` lines, where string literals (route paths) survive. */
const ROUTE = /\bapp\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\(\s*'([^']+)'/;
const FUNC = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/;
const ARROW = /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*async\b/;
const METHOD = /^ {2}(?:(?:private|protected|public|static)\s+)*async\s+(\w+)\s*[<(]/;

interface Site { file: string; line: number; enclosing: string; reader: string; word: string | null }

/** `codeOnly`'s output with every '…' and "…" literal blanked to spaces, so a quoted
 *  reader name is not a call. A template literal is kept as code: a reader named in
 *  one reads as a call, the safe direction (a false red, never a missed call). */
const blankQuoted = (code: string): string =>
  code.replace(/`(?:\\[\s\S]|[^\\`])*`|'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"/g,
    (m) => (m.startsWith('`') ? m : m.replace(/[^\n]/g, ' ')));

const enclosingOf = (codeLines: readonly string[], at: number): string => {
  for (let k = at; k >= 0; k--) {
    const l = codeLines[k];
    const route = l.match(ROUTE);
    if (route) return `${route[1].toUpperCase()} ${route[2]}`;
    const named = l.match(FUNC) ?? l.match(ARROW) ?? l.match(METHOD);
    if (named) return named[1];
  }
  return '?';
};

/** The nearest tag in a COMMENT on the three lines above `at`. A tag inside a string is no tag. */
const tagAbove = (raw: readonly string[], codeLines: readonly string[], at: number): string | null => {
  for (let k = at - 1; k >= Math.max(0, at - 3); k--) {
    const t = raw[k].match(TAG);
    if (t && !TAG.test(codeLines[k])) return t[1];
  }
  return null;
};

/** Every reader call in `src`. The definitions (`function readRegistry(`) are not calls. */
const scan = (file: string, src: string): Site[] => {
  const raw = src.split('\n');
  const code = codeOnly(src);
  const codeLines = code.split('\n');
  const callLines = blankQuoted(code).split('\n');
  const sites: Site[] = [];
  callLines.forEach((l, i) => {
    for (const m of l.matchAll(READER_CALL)) {
      if (/\bfunction\s+$/.test(l.slice(0, m.index ?? 0))) continue;
      sites.push({ file, line: i + 1, enclosing: enclosingOf(codeLines, i), reader: m[1], word: tagAbove(raw, codeLines, i) });
    }
  });
  return sites;
};

/** Tags in comments: every tag in the source, less those `codeOnly` keeps (strings). */
const commentTagCount = (src: string): number =>
  (src.match(TAGS) ?? []).length - (codeOnly(src).match(TAGS) ?? []).length;

/** Every `.ts` under server/src, recursively. */
const sources = (dir = srcRoot): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.ts$/.test(e.name) ? [full] : [];
  });

const rel = (f: string): string => path.relative(srcRoot, f).split(path.sep).join('/');
const allSites = (): Site[] => sources().flatMap((f) => scan(rel(f), readFileSync(f, 'utf8')));
const key = (s: Site): string => `${s.file} | ${s.enclosing} | ${s.reader} | ${s.word}`;
const where = (s: Site): string => `${s.file}:${s.line}`;

/** The classified set, as the tree stands. Later tasks of this wave place each `unplaced`. */
const EXPECTED_SITES: readonly string[] = [
  'commands.ts | sessionCommands | readRegistry | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistry | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'coord/fingerprint.ts | resolveDoneBranch | readRegistryMeasured | unplaced',
  'coord/routes.ts | GET /api/peers | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail/:id/ack | readRegistry | unplaced',
  'coord/routes.ts | requireAttribution | readRegistry | unplaced',
  'fleet.ts | assembleFleet | readRegistry | unplaced',
  'lifecycle.ts | listProjects | readRegistry | unplaced',
  'registry.ts | readRegistry | readRegistryMeasured | wrapper',
  'server.ts | prTasks | readRegistry | unplaced',
  'watch.ts | detectDialogs | readRegistry | unplaced',
  'watch.ts | sweepHookStates | readRegistryMeasured | unplaced',
  'watch.ts | sweepMail | readRegistryMeasured | unplaced',
  'watch.ts | sweepNames | readRegistry | unplaced',
  'watch.ts | sweepPr | readRegistry | unplaced',
  'watch.ts | sweepTasks | readRegistryMeasured | unplaced',
  'watch.ts | tick | readRegistryMeasured | unplaced',
];

describe('every registry reader call is classified for refused rows (spec §2.3)', () => {
  it('CONTROL: the scan sees a call, and ignores a comment, a string and the definitions', () => {
    const CONTROL = [
      '// readRegistry(io, cfg) named in a comment is not a call',
      "const quoted = 'readRegistryMeasured(io, cfg)';",
      'export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead> {',
      '  return { listed: false };',
      '}',
      'export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {',
      '  // [registry-refused:wrapper] the tagged call',
      '  const r = await readRegistryMeasured(io, cfg);',
      '  return r.listed ? r.records : [];',
      '}',
      'export async function untagged(io: FleetIO, cfg: CcrcConfig): Promise<number> {',
      "  const label = '[registry-refused:holds]';",
      '  return (await readRegistry(io, cfg)).length + label.length;',
      '}',
      "app.get('/api/demo', async (req, reply) => {",
      '  // [registry-refused:omits] a route',
      '  return reply.send(await readRegistry(io, cfg));',
      '});',
    ].join('\n');
    expect(scan('control.ts', CONTROL).map(key)).toEqual([
      'control.ts | readRegistry | readRegistryMeasured | wrapper',
      'control.ts | untagged | readRegistry | null',
      'control.ts | GET /api/demo | readRegistry | omits',
    ]);
    // The quoted tag is no tag: two comment tags, not three.
    expect(commentTagCount(CONTROL)).toBe(2);
  });

  it('each readRegistry( and readRegistryMeasured( call carries a [registry-refused:<word>] tag within three lines above it', () => {
    const sites = allSites();
    expect(sites.length, 'the scan found no reader call: this guard is measuring nothing').toBeGreaterThan(0);
    expect(sites.filter((s) => s.word === null).map(where), 'an untagged reader call').toEqual([]);
    expect(sites.filter((s) => s.word !== null && !WORDS.includes(s.word)).map((s) => `${where(s)} ${s.word}`),
      'a word outside the census vocabulary').toEqual([]);
    const tags = sources().reduce((n, f) => n + commentTagCount(readFileSync(f, 'utf8')), 0);
    expect(tags, 'a [registry-refused:*] tag that stands above no reader call').toBe(sites.length);
  });

  it('the classified set is exactly these 20 sites', () => {
    expect(EXPECTED_SITES).toHaveLength(20);
    expect(allSites().map(key).sort()).toEqual([...EXPECTED_SITES].sort());
  });

  it('wrapper is used once, in registry.ts, inside readRegistry', () => {
    expect(allSites().filter((s) => s.word === 'wrapper').map(key))
      .toEqual(['registry.ts | readRegistry | readRegistryMeasured | wrapper']);
  });
});

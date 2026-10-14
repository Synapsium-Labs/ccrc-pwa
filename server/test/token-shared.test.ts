// Box-token lifecycle, wave 1, Task A1: the L0 words, bounds and shapes both ends of the `token-sync` op and the
// claim door agree on (spec 2026-10-07 §4.4, §8 "Single definition", §10 "Op bounds"). Every name here is declared
// ONCE, in `shared/agent-protocol.ts` or `shared/box-token.ts`; the agent, the server and (in Part B) the PWA import
// it, and Part B's text-scan holds the shell's spellings to these values.
//
// What is pinned:
//  1. The bounds' ORDER: the agent always answers (spawn bound + kill grace + drain) before the server gives up on
//     the op, and the server gives up before the code it sent expires, so a lost answer is never a code still live.
//  2. The closed vocabularies and the exit table (a word on one side alone is a red here, not a drift).
//  3. The shapes: the claim code, the generation id (spelled once), the synced line, the transport reader.
//  4. The ninth node file, and that the inventory sweep does not read it (D-4389: the driver reads it).
//  5. `readGenerationFile`, the ONE reader of `~/.ccrc/box-token-generation`: three outcomes, malformed is unreadable.
//  6. The rotation interval and the overdue slack (4556, 4557): one home in L0, pinned by name and by value, and a scan
//     of the four shipped roots for any other numeric spelling of seven days in ms.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_CODE_RE, CLAIM_CODE_TTL_MS, GENERATION_ID_HEX, NODE_FILE_BASENAMES, NODE_FILES, TOKEN_SYNC_DRAIN_MS,
  TOKEN_SYNC_EXIT, TOKEN_SYNC_FROM, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_OP, TOKEN_SYNC_OP_ERRORS,
  TOKEN_SYNC_OP_TIMEOUT_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, TOKEN_SYNC_STDERR_PREFIX, TOKEN_SYNC_SYNCED_RE,
  TOKEN_TRANSPORTS, TOKEN_VERB_MISSING_PREFIXES, UPDATE_OP, isClaimCode, isTokenSyncOpError, isTokenVerbMissing,
  readTokenTransport, tokenSyncSpawnArgv,
} from '../../shared/agent-protocol.js';
import {
  BOX_TOKEN_PHASES, CLAIM_BODY_LIMIT_BYTES, CLAIM_REFUSALS, FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, OWED_REASONS,
  TOKEN_CLAIM_PATH, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS, TOKEN_ROTATE_PATH, TOKEN_ROTATION_INTERVAL_MS,
  TOKEN_ROTATION_OVERDUE_SLACK_MS, TOKEN_VALUE_RE, readGenerationFile,
} from '../../shared/box-token.js';
import { PENDING_FILE_RE } from '../src/token/boot.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readNodeFiles } from '../src/update/inventory.js';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOX_TOKEN_TS = path.resolve(here, '..', '..', 'shared', 'box-token.ts');

describe('the token-sync op bounds (spec §4.4, §10 "Op bounds")', () => {
  it('are the spec values', () => {
    expect(TOKEN_SYNC_SPAWN_TIMEOUT_MS).toBe(40_000);
    expect(TOKEN_SYNC_KILL_GRACE_MS).toBe(2_000);
    expect(TOKEN_SYNC_DRAIN_MS).toBe(2_000);
    expect(TOKEN_SYNC_OP_TIMEOUT_MS).toBe(50_000);
    expect(CLAIM_CODE_TTL_MS).toBe(60_000);
  });

  it('spawn bound + kill grace + drain < op timeout < code TTL: the agent answers first, and the code outlives the op', () => {
    expect(TOKEN_SYNC_SPAWN_TIMEOUT_MS + TOKEN_SYNC_KILL_GRACE_MS + TOKEN_SYNC_DRAIN_MS).toBeLessThan(TOKEN_SYNC_OP_TIMEOUT_MS);
    expect(TOKEN_SYNC_OP_TIMEOUT_MS).toBeLessThan(CLAIM_CODE_TTL_MS);
  });
});

describe('the token-sync op words (spec §4.4)', () => {
  it('the op word is its own, beside the update op', () => {
    expect(TOKEN_SYNC_OP).toBe('token-sync');
    expect(TOKEN_SYNC_OP).not.toBe(UPDATE_OP);
  });

  it('the error words are exactly the nine, closed, and isTokenSyncOpError reads them and nothing else', () => {
    expect([...TOKEN_SYNC_OP_ERRORS]).toEqual(['bad-code', 'busy', 'spawn-failed', 'claim-refused', 'code-used',
      'write-failed', 'proof-failed', 'proof-unmeasured', 'stale-client']);
    for (const w of TOKEN_SYNC_OP_ERRORS) expect(isTokenSyncOpError(w), w).toBe(true);
    // `bad-request` stays the envelope's word for "this agent predates the op"; there is no insecure-url word (R2).
    for (const w of ['bad-request', 'insecure-url', 'BUSY', '', null, 1, undefined]) expect(isTokenSyncOpError(w), String(w)).toBe(false);
  });

  it('the exit table covers every verb word, exactly once, 20 to 26, and never the two agent-only words', () => {
    expect({ ...TOKEN_SYNC_EXIT }).toEqual({
      'bad-code': 20, 'claim-refused': 21, 'code-used': 22, 'write-failed': 23,
      'proof-failed': 24, 'proof-unmeasured': 25, 'stale-client': 26,
    });
    expect(Object.keys(TOKEN_SYNC_EXIT).sort())
      .toEqual(TOKEN_SYNC_OP_ERRORS.filter((w) => w !== 'busy' && w !== 'spawn-failed').sort());
    expect(new Set(Object.values(TOKEN_SYNC_EXIT)).size).toBe(Object.keys(TOKEN_SYNC_EXIT).length);
    expect(Object.isFrozen(TOKEN_SYNC_EXIT)).toBe(true);
  });

  it('the refusal line prefix and the synced line', () => {
    expect(TOKEN_SYNC_STDERR_PREFIX).toBe('ccrc: token sync: ');
    // The exact source, because Part B's shell-parity scan compares the verb's printf against it.
    expect(TOKEN_SYNC_SYNCED_RE.source).toBe('^synced ([0-9a-f]{16}) (http|https)$');
    expect(TOKEN_SYNC_SYNCED_RE.exec('synced 0123456789abcdef https')?.slice(1)).toEqual(['0123456789abcdef', 'https']);
    expect(TOKEN_SYNC_SYNCED_RE.exec('synced 0123456789abcdef http')?.slice(1)).toEqual(['0123456789abcdef', 'http']);
    for (const bad of ['synced 0123456789ABCDEF https', 'synced 0123456789abcde https', 'synced 0123456789abcdef ws',
      'synced 0123456789abcdef', ' synced 0123456789abcdef https', 'synced 0123456789abcdef https\nx']) {
      expect(TOKEN_SYNC_SYNCED_RE.test(bad), bad).toBe(false);
    }
  });

  it('readTokenTransport is the one reader of the additive transport field: absence and junk are unmeasured, never https', () => {
    expect([...TOKEN_TRANSPORTS]).toEqual(['http', 'https']);
    expect(readTokenTransport('http')).toBe('http');
    expect(readTokenTransport('https')).toBe('https');
    for (const raw of [undefined, null, '', 'HTTPS', 'ws', 'wss', 1, true, ['https'], { t: 'https' }]) {
      expect(readTokenTransport(raw), JSON.stringify(raw)).toBe('unmeasured');
    }
  });

  it('the claim code is 32 random bytes as unpadded base64url, and isClaimCode is its one guard', () => {
    expect(CLAIM_CODE_RE.source).toBe('^[A-Za-z0-9_-]{43}$');
    for (let i = 0; i < 200; i += 1) {
      const code = randomBytes(32).toString('base64url');
      expect(isClaimCode(code), 'a minted code').toBe(true);
    }
    const good = 'A'.repeat(43);
    for (const bad of ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, `${'A'.repeat(42)}/`,
      `${'A'.repeat(42)}\n`, `${good}\n`, ` ${'A'.repeat(42)}`, '']) {
      expect(isClaimCode(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [undefined, null, 43, ['A'.repeat(43)]]) expect(isClaimCode(bad)).toBe(false);
    expect(isClaimCode(good)).toBe(true);
  });

  it('the spawn argv is one frozen template with no variable token', () => {
    expect(TOKEN_SYNC_FROM).toBe('agent');
    const argv = tokenSyncSpawnArgv();
    expect([...argv]).toEqual(['token', 'sync', '--from', 'agent']);
    expect(Object.isFrozen(argv)).toBe(true);
    expect(() => (argv as string[]).push('--x')).toThrow(TypeError);
    expect([...tokenSyncSpawnArgv()]).toEqual(['token', 'sync', '--from', 'agent']);
  });

  it('isTokenVerbMissing names an older ccrc and an absent launcher, and nothing else (D-4395)', () => {
    expect([...TOKEN_VERB_MISSING_PREFIXES]).toEqual(['ccrc: unknown argument: token', 'could not start the launcher']);
    expect(isTokenVerbMissing('ccrc: unknown argument: token')).toBe(true);
    expect(isTokenVerbMissing('could not start the launcher (ENOENT)')).toBe(true);
    expect(isTokenVerbMissing('could not start the launcher (EACCES)')).toBe(true);
    for (const d of [null, undefined, '', 'no message', 'ccrc: token sync: bad-code: x', 'ccrc: unknown argument: update',
      ' ccrc: unknown argument: token']) {
      expect(isTokenVerbMissing(d), String(d)).toBe(false);
    }
  });
});

describe('the ninth node file (spec 4.5, §8 "No secret in the agent\'s read grant")', () => {
  it('NODE_FILES.tokenGeneration is box-token-generation, and the derived list carries nine names', () => {
    expect(NODE_FILES.tokenGeneration).toBe('box-token-generation');
    expect(NODE_FILE_BASENAMES).toHaveLength(9);
    expect(NODE_FILE_BASENAMES).toContain('box-token-generation');
  });

  it('the inventory sweep never reads it: the driver does (D-4389)', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-token-shared-inv-'), '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    writeFileSync(path.join(ccrcDir, NODE_FILES.tokenGeneration), '0123456789abcdef\n');
    const asked: string[] = [];
    const recording: FleetIO = {
      ...localIO,
      lstatMeasured: async (p: string) => { asked.push(path.basename(p)); return localIO.lstatMeasured(p); },
    };
    const reads = await readNodeFiles(recording, ccrcDir, 5_000);
    expect(Object.keys(reads)).not.toContain('tokenGeneration');
    expect(asked.length, 'the sweep read nothing at all').toBeGreaterThan(0);
    expect(asked).not.toContain('box-token-generation');
  });
});

describe('shared/box-token.ts — the claim door, value and generation shapes, and the lifecycle words', () => {
  it('the two routes, the body bound and the value and generation shapes', () => {
    expect(TOKEN_CLAIM_PATH).toBe('/api/token/claim');
    expect(TOKEN_ROTATE_PATH).toBe('/api/token/rotate');
    expect(CLAIM_BODY_LIMIT_BYTES).toBe(1024);
    expect(TOKEN_VALUE_RE.source).toBe('^[0-9a-f]{64}$');
    expect(TOKEN_VALUE_RE.test(randomBytes(32).toString('hex'))).toBe(true);
    expect(TOKEN_VALUE_RE.test('A'.repeat(64))).toBe(false);
    expect(GENERATION_ID_RE.source).toBe('^[0-9a-f]{16}$');
    expect(GENERATION_ID_RE.test(randomBytes(8).toString('hex'))).toBe(true);
  });

  it('the generation-id shape is spelled once: both regexes are built from GENERATION_ID_HEX', () => {
    expect(GENERATION_ID_HEX).toBe('[0-9a-f]{16}');
    expect(GENERATION_ID_RE.source).toContain(GENERATION_ID_HEX);
    expect(TOKEN_SYNC_SYNCED_RE.source).toContain(GENERATION_ID_HEX);
    const src = readFileSync(BOX_TOKEN_TS, 'utf8');
    expect(src.includes('{16}'), 'box-token.ts re-spells the generation id').toBe(false);
  });

  // F11 (review 349, class 9): the shape scan reaches the server's token ring too, so a regex there that spells the
  // generation id a second time reds. `PENDING_FILE_RE` is the one place a filename carries an id.
  it('no file under server/src/token/ re-spells the generation id; PENDING_FILE_RE is built from GENERATION_ID_HEX', () => {
    const dir = path.join(path.dirname(BOX_TOKEN_TS), '..', 'server', 'src', 'token');
    const files = readdirSync(dir).filter((n) => n.endsWith('.ts'));
    expect(files).toContain('boot.ts');
    for (const f of files) {
      expect(readFileSync(path.join(dir, f), 'utf8').includes('{16}'), `${f} re-spells the generation id`).toBe(false);
    }
    expect(PENDING_FILE_RE.source).toContain(GENERATION_ID_HEX);
    expect(PENDING_FILE_RE.exec(`mail-pending-${'0123456789abcdef'}.token`)?.[1]).toBe('0123456789abcdef');
    expect(PENDING_FILE_RE.exec('mail-pending-0123456789abcde.token')).toBeNull();
    expect(PENDING_FILE_RE.exec('mail-pending-0123456789ABCDEF.token')).toBeNull();
  });

  it('the closed vocabularies', () => {
    expect([...CLAIM_REFUSALS]).toEqual(['bad-request', 'wrong-node', 'no-claim', 'code-expired', 'code-used', 'rate-limited', 'unavailable']);
    expect([...TOKEN_ORIGINS]).toEqual(['adopted', 'minted', 'rotated']);
    expect([...OWED_REASONS]).toEqual(['adopted', 'fleet-behind', 'confirm-deadline', 'retired-written-back', 'recovered',
      'aux-unusable', 'unverifiable-files', 'code-used', 'claim-misbound', 'retired-presented']);   // 'retired-presented': D-4412 (additive)
    expect([...TOKEN_HOLDS]).toEqual(['update-in-flight', 'agent-predates-op', 'verb-missing', 'stale-client', 'fleet-rows',
      'node-id-unmeasured', 'link-down', 'pending-cap', 'no-coord', 'role-unrecorded', 'mint-failed']);
    expect([...BOX_TOKEN_PHASES]).toEqual(['unconfigured', 'idle', 'staged', 'handed-out', 'promoting', 'grace', 'held', 'failed']);
    // Added at plan assembly (review: the run-time re-read); its words are never the read vocabulary's pair.
    expect([...TOKEN_FILE_PROBLEMS]).toEqual(['missing', 'unusable', 'placeholder', 'unreadable', 'changed', 'retired']);
  });

  it('the fleet file comment is one printable-ASCII comment line', () => {
    expect(FLEET_TOKEN_FILE_COMMENT).toBe('# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it');
    expect(FLEET_TOKEN_FILE_COMMENT).toMatch(/^# [\x20-\x7e]+$/);
  });

  it('readGenerationFile: an id, absent, or unreadable; too-large and every malformed body read unreadable', () => {
    expect(readGenerationFile({ ok: true, content: '0123456789abcdef\n' })).toEqual({ kind: 'id', id: '0123456789abcdef' });
    expect(readGenerationFile({ ok: false, reason: 'absent' })).toEqual({ kind: 'absent' });
    expect(readGenerationFile({ ok: false, reason: 'unreadable' })).toEqual({ kind: 'unreadable' });
    expect(readGenerationFile({ ok: false, reason: 'too-large' })).toEqual({ kind: 'unreadable' });
    for (const content of ['0123456789abcdef', '0123456789ABCDEF\n', '0123456789abcde\n', '0123456789abcdef0\n',
      '0123456789abcdef\n\n', '0123456789abcdef\r\n', ' 0123456789abcdef\n', '0123456789abcdef\nx\n', '', '\n']) {
      expect(readGenerationFile({ ok: true, content }), JSON.stringify(content)).toEqual({ kind: 'unreadable' });
    }
  });

  it('is L0: it imports only its shared siblings, never node:*', () => {
    const src = readFileSync(BOX_TOKEN_TS, 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(new Set(specs)).toEqual(new Set(['./api.js', './agent-protocol.js']));
    expect(/\brequire\(|import\(|['"]node:/.test(src), 'a require, a dynamic import or a node: specifier').toBe(false);
  });
});

// 4556, 4557: the weekly interval and its overdue slack are declared ONCE, in L0, and held there by NAME (one
// definition) and by VALUE (no other numeric expression in the four shipped roots equals seven days in ms, in the
// spellings the controls below show). The seven-day regex in `single-definition.test.ts` scans `server/src` and
// `pwa/src` only and lets `604_800_000` and `7 * 86_400_000` through; this scan covers `shared/` and `agent/src` too
// and reads products.
//
// What the scan does NOT see: a sum (`6 * DAY + DAY`), a division, a float or exponent literal (`6.048e8`), a
// lower-case or imported-alias name, a value built at run time, and a product with parenthesised grouping
// (`(7 * 24) * 60 * 60_000`). Its name table is built from `const NAME = <product>;` on one line, with an optional
// `export` and an optional `: number`: a name defined by `let`, with `as const`, or across lines is no entry, and a
// chain of names ordered against the file walk and deeper than the table's three passes stays unresolved. The table
// is one for all files and the last definition wins, so two files that define one name with different values make a
// product of it resolve to the later one (today `CLEAR_POLL_MS` and `POLL_MS` are each defined twice with different
// values; neither reaches seven days). The roots are read for `.ts` and `.tsx` only: the deploy-side `shared/*.mjs` and
// the `*.d.mts` files are outside the scan, and none holds a seven-day value today.
// The controls below pin what it does see.
describe('the rotation interval: declared once in L0, pinned by name and by value (4556, 4557)', () => {
  const REPO = path.resolve(here, '..', '..');
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(REPO, r));
  const rel = (f: string): string => path.relative(REPO, f).split(path.sep).join('/');

  // `__`-prefixed entries are transient mutants a parallel suite writes (same guard and reason as
  // `single-definition.test.ts`'s `sources`): they vanish mid-walk and are verbatim copies while they exist.
  function sourcesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__')) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...sourcesUnder(p)); continue; }
      if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }

  /** Comment lines emptied (as `single-definition.test.ts` filters them), a trailing `//` comment cut, line numbers kept. */
  const codeLines = (text: string): string[] =>
    text.split('\n').map((l) => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l.replace(/\s\/\/.*$/, '')));

  const FACTOR = String.raw`(?:\d[\d_]*|[A-Z][A-Z0-9_]*)`;
  const PRODUCT = new RegExp(String.raw`(?<![\w.$])${FACTOR}(?:\s*\*\s*${FACTOR})*(?![\w.])`, 'g');
  const DEFINE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*([^;]+);/;
  const WEEK_MS = 604_800_000;

  /** The factors of a product text, or null when it is not a pure product of factors. */
  const factorsOf = (text: string): string[] | null => {
    const t = text.trim();
    return new RegExp(`^${FACTOR}(?:\\s*\\*\\s*${FACTOR})*$`).test(t) ? t.split('*').map((s) => s.trim()) : null;
  };

  /** The product's value, or null when a factor is a name the table does not resolve. */
  const valueOf = (factors: string[], table: Map<string, number>): number | null => {
    let v = 1;
    for (const f of factors) {
      const n = /^\d/.test(f) ? Number(f.replace(/_/g, '')) : table.get(f);
      if (n === undefined || Number.isNaN(n)) return null;
      v *= n;
    }
    return v;
  };

  function sevenDayHolders(files: { rel: string; text: string }[]): string[] {
    const lines = files.map((f) => ({ rel: f.rel, code: codeLines(f.text) }));
    // Three passes, so a name defined from another name resolves whatever the file order.
    const table = new Map<string, number>();
    for (let pass = 0; pass < 3; pass++) {
      for (const f of lines) {
        for (const l of f.code) {
          const d = DEFINE.exec(l);
          const factors = d ? factorsOf(d[2]) : null;
          const v = d && factors ? valueOf(factors, table) : null;
          if (d && v !== null) table.set(d[1], v);
        }
      }
    }
    const hits = new Set<string>();
    for (const f of lines) {
      f.code.forEach((l, i) => {
        for (const m of l.matchAll(PRODUCT)) {
          const factors = m[0].split('*').map((s) => s.trim());
          // A lone name is a reference to a quantity, never a second holder of it.
          if (!factors.some((x) => /^\d/.test(x)) && factors.length < 2) continue;
          if (valueOf(factors, table) !== WEEK_MS) continue;
          const d = DEFINE.exec(l);
          hits.add(d ? `${f.rel}:${d[1]}` : `${f.rel}:line ${i + 1}`);
        }
      });
    }
    return [...hits].sort();
  }

  const ALL = ROOTS.flatMap((r) => sourcesUnder(r)).map((f) => ({ rel: rel(f), text: readFileSync(f, 'utf8') }));

  it('TOKEN_ROTATION_INTERVAL_MS is seven days and the slack one day, by value', () => {
    expect(TOKEN_ROTATION_INTERVAL_MS).toBe(604_800_000);
    expect(TOKEN_ROTATION_OVERDUE_SLACK_MS).toBe(86_400_000);
  });

  it('each is defined in exactly one file, shared/box-token.ts', () => {
    for (const name of ['TOKEN_ROTATION_INTERVAL_MS', 'TOKEN_ROTATION_OVERDUE_SLACK_MS']) {
      const DEFINES = new RegExp(`^\\s*(?:export\\s+)?const\\s+${name}\\s*=`, 'm');
      expect(ALL.filter((f) => DEFINES.test(f.text)).map((f) => f.rel), name).toEqual(['shared/box-token.ts']);
    }
  });

  const DAY = { rel: 'd.ts', text: 'const DAY_MS = 86_400_000;' };
  const SEEN: { name: string; files: { rel: string; text: string }[]; want: string[] }[] = [
    ...['604_800_000', '604800000', '7 * 86_400_000', '7 * 86400000', '7 * 24 * 3_600_000', '7 * 24 * 3600 * 1000',
      '168 * 60 * 60_000', '10_080 * 60_000', '7 * 24 * 60 * 60_000', '7*24*60*60*1000']
      .map((s) => ({ name: s, files: [{ rel: 'x.ts', text: `const A = ${s};` }], want: ['x.ts:A'] })),
    // `7 * DAY_MS` with DAY_MS defined on the line above: the holder is A, and DAY_MS itself is none.
    { name: 'name, line above',
      files: [{ rel: 'x.ts', text: 'const DAY_MS = 86_400_000;\nconst A = 7 * DAY_MS;' }], want: ['x.ts:A'] },
    // `7 * DAY_MS` with DAY_MS defined in another file.
    { name: 'name, other file',
      files: [DAY, { rel: 'x.ts', text: 'const A = 7 * DAY_MS;' }], want: ['x.ts:A'] },
    // The same expression on a line with no const is named by its line.
    { name: 'name, no const',
      files: [DAY, { rel: 'x.ts', text: 'f(7 * DAY_MS);' }], want: ['x.ts:line 1'] },
  ];
  it.each(SEEN)('the scan sees $name (CONTROLS)', ({ files, want }) => {
    expect(sevenDayHolders(files)).toEqual(want);
  });

  // Vitest clips a long `$name` in a row title to about 37 characters and an ellipsis, which cut three of these rows
  // mid-word. A name is short and the reason it gives lives in a comment above its row.
  it('every CONTROLS row name fits the clip vitest puts on a row title, so a red names its row in full', () => {
    const NAME_CLIP = 32;
    for (const c of SEEN) expect(c.name.length, c.name).toBeLessThanOrEqual(NAME_CLIP);
    expect(new Set(SEEN.map((c) => c.name)).size, 'a name is used twice').toBe(SEEN.length);
  });

  it('the scan does not count a reference, a comment, or another number (CONTROLS)', () => {
    // a lone reference to a resolvable name is a reference: W is the holder, B is not
    expect(sevenDayHolders([{ rel: 'x.ts', text: 'const W = 604_800_000;\nconst B = W;' }])).toEqual(['x.ts:W']);
    expect(sevenDayHolders([{ rel: 'x.ts', text: '// 7 * 24 * 3_600_000\n x(); // 604_800_000' }])).toEqual([]);
    expect(sevenDayHolders([{ rel: 'x.ts', text: 'const C = 7 * 24 * 60 * 60_001;\nconst D = 604800;' }])).toEqual([]);
  });

  // What a red of the holders row says. The row reds in two directions (a holder added, a holder gone), so the words
  // must be true of both: the pin below holds the message to naming each.
  const HOLDERS_MESSAGE = 'the seven-day holders changed. A new one must import TOKEN_ROTATION_INTERVAL_MS from '
    + 'shared/box-token.ts, or be ruled in as a separate quantity; '
    + 'a missing one means the L0 home moved or changed value';

  it('the holders row\'s failure message names both directions: a new holder, and a missing one', () => {
    expect(HOLDERS_MESSAGE, 'a new holder').toMatch(/import TOKEN_ROTATION_INTERVAL_MS[^]*ruled in/);
    expect(HOLDERS_MESSAGE, 'a missing holder').toMatch(/missing[^]*(moved|changed value)/);
  });

  it('the holders across shared, server/src, pwa/src and agent/src are exactly the three separate seven-day quantities', () => {
    // A weekly interval anywhere else must import the one in shared/box-token.ts. These three are separate
    // quantities (the coordinator confirmed them, Q2); a new, unrelated seven-day quantity needs a ruling to join.
    expect(sevenDayHolders(ALL), HOLDERS_MESSAGE).toEqual([
      'server/src/childReclaimSweep.ts:CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS',
      'shared/api.ts:LEDGER_STALE_MS',
      'shared/box-token.ts:TOKEN_ROTATION_INTERVAL_MS',
    ]);
  });
});

describe('the verb-missing line against the tree\'s real ccd/ccrc (F8)', () => {
  // LIVE SAFETY rests on this: a fleet box whose ccrc has no `token` verb answers the agent's spawn with
  // `_ccrc_usage_die`'s line, and the driver maps it to the learned `verb-missing` hold instead of counting a failure.
  // Every other test types that literal by hand; this one runs the REAL script, read-only, under a fixture HOME with the
  // poisoned tools first on PATH (never the live HOME, never an edit of ccd/), with a verb that can never exist, so it
  // holds for as long as ccrc's refusal of an unknown verb is spelled this way, whether or not ccrc later gains `token`.
  // It holds the refusal's FIRST stderr line to the shape L0's detector reads, and the detector to that shape.
  const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');
  const NO_SUCH_VERB = 'ccrc-no-such-verb-zzz';

  it('an unknown verb exits 2 and its FIRST stderr line is exactly "ccrc: unknown argument: <verb>", which L0 reads as verb-missing for `token`', () => {
    const home = mkTmp('ccrc-verb-missing-');
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    assertNoRealTool(env, home);
    expect(env.HOME).toBe(home);
    const r = spawnSync('bash', [CCRC, NO_SUCH_VERB, ...tokenSyncSpawnArgv().slice(1)], { env, encoding: 'utf8', input: '' });
    expect(r.status, 'a usage error').toBe(2);
    const first = (r.stderr ?? '').split('\n')[0]!;
    expect(first, 'the FIRST line, because the agent reports its first stderr line as the detail').toBe(`ccrc: unknown argument: ${NO_SUCH_VERB}`);
    expect(isTokenVerbMissing(first.replace(NO_SUCH_VERB, 'token'))).toBe(true);
    expect(isTokenVerbMissing(first), 'the detector is for the token verb only').toBe(false);
    expect(isTokenVerbMissing(`usage: ccrc\n${first}`), 'a usage line first would not map').toBe(false);
  });
});

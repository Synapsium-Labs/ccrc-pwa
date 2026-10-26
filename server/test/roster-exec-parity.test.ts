import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `shared/roster.ts` and `shared/roster-json.mjs` each declare their own
 *  `EXEC_KINDS`, by hand, and nothing compares them. `single-definition.test.ts`
 *  scans `/\.tsx?$/` over four TypeScript roots, so the `.mjs` copy is invisible
 *  to it. The asymmetry is what makes this worth a suite of its own:
 *
 *    - a kind in the PARSER but not the mirror -> `ccrc install` refuses a
 *      roster the server boots on. Loud, and recoverable.
 *    - a kind in the MIRROR but not the parser -> `ccd` gets a projection from a
 *      roster `loadConfig` refuses, and `ccrc.service` crash-loops behind a
 *      green deploy. That is the outcome the mirror's own header calls the
 *      worst available one.
 *
 *  So this extracts both literals from source text and compares the SETS. It
 *  deliberately does not import either module: importing `shared/roster.ts`
 *  would give the value, not the declaration, and a value cannot show that the
 *  two files were written to agree. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function execKindsIn(file: string): string[] {
  const src = readFileSync(path.join(root, file), 'utf8');
  const m = src.match(/EXEC_KINDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  if (m === null) throw new Error(`no EXEC_KINDS declaration found in ${file} - re-read it`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

describe('EXEC_KINDS parity between the parser and its bare-Node mirror', () => {
  it('finds a declaration in both files', () => {
    expect(execKindsIn('shared/roster.ts').length).toBeGreaterThanOrEqual(4);
    expect(execKindsIn('shared/roster-json.mjs').length).toBeGreaterThanOrEqual(4);
  });

  it('the two sets are identical', () => {
    expect(execKindsIn('shared/roster-json.mjs')).toEqual(execKindsIn('shared/roster.ts'));
  });

  it('both name codex', () => {
    expect(execKindsIn('shared/roster.ts')).toContain('codex');
    expect(execKindsIn('shared/roster-json.mjs')).toContain('codex');
  });
});

/** The same extraction for `telemetry`'s closed set (D-5521, D-5753). A value in the
 *  parser but not the mirror is the loud half (`ccrc install` refuses); a value in the
 *  mirror but not the parser is the crash loop above. A26 writes `openrouter` from the
 *  box, AGENT-FIRST, so both parsers must accept it before that verb ships. */
function telemetryValuesIn(file: string): string[] {
  const src = readFileSync(path.join(root, file), 'utf8');
  // An object of `<value>: true`, not an array (single-definition.test.ts reads two provider ids in one `[...]`
  // as a restatement of the provider table), so the keys are what is compared.
  const m = src.match(/TELEMETRY_VALUES[^=]*=\s*(?:Object\.freeze\()?\{([^}]*)\}/);
  if (m === null) throw new Error(`no TELEMETRY_VALUES declaration found in ${file} - re-read it`);
  return [...m[1]!.matchAll(/([a-z]+):\s*true/g)].map((x) => x[1]!).sort();
}

describe('TELEMETRY_VALUES parity between the parser and its bare-Node mirror (D-5521)', () => {
  it('the two sets are identical', () => {
    expect(telemetryValuesIn('shared/roster-json.mjs')).toEqual(telemetryValuesIn('shared/roster.ts'));
  });

  it('both name openrouter beside the three earlier values', () => {
    for (const f of ['shared/roster.ts', 'shared/roster-json.mjs']) {
      expect(telemetryValuesIn(f)).toEqual(['anthropic', 'codex', 'none', 'openrouter']);
    }
  });
});

/** The behaviour, not only the declaration: a set the check never reads would pass the
 *  extraction above and still refuse the value. */
describe('telemetry "openrouter" in both parsers (D-5521)', () => {
  const rosterWith = (telemetry: unknown) => ({
    version: 1,
    accounts: [
      { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-d', label: 'lane-d', configDirSuffix: '.claude-lane-d',
        exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-d-openrouter.env' },
        homeAble: true, hue: 'amber', telemetry },
    ],
  });

  it('a roster with telemetry openrouter parses in both parsers', async () => {
    const { parseRoster } = await import('../../shared/roster.js');
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    expect(parseRoster(rosterWith('openrouter')).accounts[1]!.telemetry).toBe('openrouter');
    expect(rosterFromJson(rosterWith('openrouter')).accounts[1]!.telemetry).toBe('openrouter');
  });

  it('an unknown value is still refused by both, and both name the four values', async () => {
    const { parseRoster } = await import('../../shared/roster.js');
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    for (const parse of [parseRoster, rosterFromJson] as const) {
      let caught: unknown;
      try { parse(rosterWith('open-router')); } catch (e) { caught = e; }
      expect(String((caught as Error | undefined)?.message)).toMatch(/invalid telemetry "open-router"/);
      expect((caught as { remedy?: string }).remedy).toMatch(/"anthropic", "codex", "openrouter" or "none"/);
    }
  });

  it('a name the value set inherits from Object.prototype is refused by both (own keys only)', async () => {
    // `telemetry in TELEMETRY_VALUES` would let these through; the check reads own keys.
    const { parseRoster } = await import('../../shared/roster.js');
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    for (const parse of [parseRoster, rosterFromJson] as const) {
      for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
        let caught: unknown;
        try { parse(rosterWith(bad)); } catch (e) { caught = e; }
        expect(String((caught as Error | undefined)?.message), `${parse.name} took "${bad}"`)
          .toMatch(new RegExp(`invalid telemetry "${bad}"`));
      }
    }
  });
});

/** codex-bridge Stage 2, Task 10 (spec D20): `exec.bridge` and `exec.upstream`'s closed sets, declared once in each
 *  parser, compared IN ORDER — the first entry of each is the default an absent key reads, so a reordering is a change
 *  of default and must red here, not only in a behaviour row. */
function codexWordsIn(file: string, name: 'CODEX_BRIDGE_MODES' | 'CODEX_UPSTREAMS'): string[] {
  const src = readFileSync(path.join(root, file), 'utf8');
  const m = src.match(new RegExp(`${name}[^=]*=\\s*(?:Object\\.freeze\\()?\\[([^\\]]*)\\]`));
  if (m === null) throw new Error(`no ${name} declaration found in ${file} - re-read it`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe('CODEX_BRIDGE_MODES and CODEX_UPSTREAMS parity between the parser and its bare-Node mirror', () => {
  it('both files declare both sets, the default first', () => {
    for (const f of ['shared/roster.ts', 'shared/roster-json.mjs']) {
      expect(codexWordsIn(f, 'CODEX_BRIDGE_MODES'), f).toEqual(['litellm', 'direct']);
      expect(codexWordsIn(f, 'CODEX_UPSTREAMS'), f).toEqual(['backend', 'siwc']);
    }
  });

  // The bash readers of a rendered lane.json (`_codex_lane_mode`, `_codex_lane_upstream` in ccd/ccrc) carry a third
  // spelling of both sets, as one quoted space-separated list each. A word added to roster.ts alone would render into
  // lane.json and then read `lane-*-unreadable` in bash for a valid roster, so the two lines are pinned here, in order.
  it.each([
    ['_codex_lane_mode', 'CODEX_BRIDGE_MODES'],
    ['_codex_lane_upstream', 'CODEX_UPSTREAMS'],
  ] as const)('ccd/ccrc\'s %s carries exactly roster.ts\'s %s, in order', (fn, name) => {
    const src = readFileSync(path.join(root, 'ccd/ccrc'), 'utf8');
    const lines = src.split('\n').filter((l) => l.startsWith(`${fn}() `));
    expect(lines, `one ${fn} definition line in ccd/ccrc`).toHaveLength(1);
    const m = lines[0]!.match(/^\S+\(\)\s*\{\s*_codex_lane_word\s+"\$\{1:-\}"\s+\S+\s+\S+\s+"([^"]*)";\s*\}$/);
    if (m === null) throw new Error(`${fn}'s line in ccd/ccrc is not the one-line _codex_lane_word call - re-read it`);
    expect(m[1]!.split(' ')).toEqual(codexWordsIn('shared/roster.ts', name));
  });

  const rosterWith = (exec: Record<string, unknown>) => ({
    version: 1,
    accounts: [
      { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-c', label: 'lane-c', configDirSuffix: '.claude-lane-c',
        exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011,
          authDir: '.local/share/ccrc/codex/lane-c', ...exec },
        homeAble: false, hue: 'violet', telemetry: 'codex' },
    ],
  });

  it.each([
    ['a row with neither key', {}, { bridge: 'litellm', upstream: 'backend' }],
    ['a row with both keys', { bridge: 'direct', upstream: 'siwc' }, { bridge: 'direct', upstream: 'siwc' }],
  ] as const)('the resolved bridge and upstream defaults are equal in roster.ts and roster-json (%s)', async (_why, exec, want) => {
    const { parseRoster } = await import('../../shared/roster.js');
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    const ts = parseRoster(rosterWith(exec)).byId.get('lane-c')!.exec as { bridge?: unknown; upstream?: unknown };
    const mjs = rosterFromJson(rosterWith(exec)).accounts.find((a) => a.id === 'lane-c')!;
    expect({ bridge: ts.bridge, upstream: ts.upstream }).toEqual(want);
    expect({ bridge: mjs.bridge, upstream: mjs.upstream }).toEqual(want);
  });

  it('a non-codex row carries neither resolved field from the mirror', async () => {
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    const up = rosterFromJson(rosterWith({})).accounts.find((a) => a.id === 'lane-a')!;
    expect(Object.prototype.hasOwnProperty.call(up, 'bridge')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(up, 'upstream')).toBe(false);
  });
});

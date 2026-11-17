/**
 * Overlord W1, the vocabulary piece, Task 3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-vocabulary.md`;
 * spec §11.6, Table 11.6, Appendix B "The refusal list"). Table 11.6 is read from the spec and checked against the code's
 * refusal words in BOTH directions, so the table and the code cannot drift apart again:
 *
 * - table to code: every word of the table is a route refusal (`ROUTE_REFUSALS`, never a text search, so a word spelled
 *   elsewhere with another meaning does not count), or on `waveMap` with the wave that adds it, or a release-reason
 *   pattern on `releaseReasons`;
 * - code to table: every word of the Overlord's groups (`OVERLORD_GROUPS`) is in the table, or on `codeOnly`, a
 *   shrink-only list checked against the merge base.
 *
 * Both lists live in `refusal-table.data.json`. A stale entry in either is red. It is a guard suite
 * (`.github/ci/fast-plan.mjs#GUARD_TESTS`) because it reads a `docs/` file, which no import reaches (the plan's
 * question 4): a spec pull request that changes the table runs it on its first fast run.
 *
 * FAIL CLOSED: a spec it cannot read, a table it cannot find by its heading and caption, another header row, or fewer
 * than 70 rows is red, never a pass over an empty parse.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as refusal from '../../../shared/refusal.js';
import * as api from '../../../shared/api.js';
import * as delegationAdopt from '../../../shared/delegation-adopt.js';
import { LANE_ARM_REFUSALS } from '../../../shared/lane-arm.js';
import { ts } from '../scan/parse.js';
import { ccrcRoot } from './helpers.js';

const {
  CARD_REFUSALS, GENERIC_REFUSALS, NOTE_REFUSALS, OVERLORD_REFUSALS, OVERLORD_REFUSAL_WORDS, PROBE_REFUSALS,
  DECISION_MODEL_REFUSALS, REFUSAL_STATUS, ROUTE_REFUSALS, START_LOADS_REFUSALS, TIMER_REFUSALS, isOverlordRefusal,
} = refusal;

const SPEC = 'docs/superpowers/specs/2026-11-09-overlord-design.md';
const DATA = 'server/test/single-definition/refusal-table.data.json';
const HEADING = '### 11.6 Refusal words';
const CAPTION = '*Table 11.6.';
const HEADER = '| Word | Door or lane | Meaning | Call |';
const MIN_ROWS = 70;
/** The waves a table word can wait for. Neither `W1` nor `W2` is one, so no W1 or W2 word can be deferred (the W2
 *  vocabulary plan's question 3): a spec fix that adds a W2 word to Table 11.6 adds it to the group in the same PR. */
const WAVES = new Set(['W1a', 'W3', 'W4', 'W4b', 'W5', 'W6']);

interface Data { codeOnly: Record<string, string>; waveMap: Record<string, string>; releaseReasons: Record<string, string> }

/** Table 11.6's first cells, in order. Throws on anything it cannot read whole. */
export function tableWords(spec: string): string[] {
  const lines = spec.split('\n');
  const from = lines.indexOf(HEADING);
  if (from === -1) throw new Error(`Table 11.6: no heading ${HEADING}`);
  const to = lines.findIndex((l, i) => i > from && l.startsWith(CAPTION));
  if (to === -1) throw new Error(`Table 11.6: no caption line starting ${CAPTION}`);
  const rows = lines.slice(from + 1, to).filter((l) => l.startsWith('|'));
  if (rows[0] !== HEADER) throw new Error(`Table 11.6: the header row is not ${HEADER}`);
  if (!/^\|(?:\s*-+\s*\|)+$/.test(rows[1] ?? '')) throw new Error('Table 11.6: no separator row under the header');
  const words = rows.slice(2).map((r, i) => {
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(r);
    if (m === null) throw new Error(`Table 11.6: row ${i + 1} has no backquoted word in its first cell`);
    return m[1]!;
  });
  if (words.length < MIN_ROWS) throw new Error(`Table 11.6: ${words.length} rows, fewer than ${MIN_ROWS}`);
  return words;
}

/** A release-reason pattern row, not a refusal word. */
const isPattern = (w: string): boolean => w.includes(':<') || w === 'server-gap';

/** Each Overlord group's words, by its name. A W1a group that names the Overlord in its doc comment registers here. */
const OVERLORD_GROUPS: Readonly<Record<string, readonly string[]>> = {
  OVERLORD_REFUSALS: Object.keys(OVERLORD_REFUSALS),
  CARD_REFUSALS: Object.values(CARD_REFUSALS),
  NOTE_REFUSALS: Object.values(NOTE_REFUSALS),
  PROBE_REFUSALS: Object.values(PROBE_REFUSALS),
  TIMER_REFUSALS: Object.keys(TIMER_REFUSALS),
  START_LOADS_REFUSALS: Object.values(START_LOADS_REFUSALS),   // the loads door's word (Overlord W1 sandbox, Task 5)
  DECISION_MODEL_REFUSALS: Object.keys(DECISION_MODEL_REFUSALS),   // the decision-model doors (Overlord W2, decision model B, Task 7)
  // Hand-registered: LANE_ARM_REFUSALS' comment does not name the Overlord, and only its `lane-gated` and the replay
  // quiz's `baseline-missing` are route words of the table.
  'LANE_ARM_REFUSALS#lane-gated,baseline-missing': LANE_ARM_REFUSALS.filter((w) => w === 'lane-gated' || w === 'baseline-missing'),
};

/** The two directions' findings, pure over the table, the code's words, the Overlord's words and the data. */
export function tableFindings(table: readonly string[], route: ReadonlySet<string>, overlord: ReadonlySet<string>, d: Data): string[] {
  const out: string[] = [];
  const inTable = new Set(table);
  for (const w of table) {
    if (isPattern(w)) {
      if (!(w in d.releaseReasons)) out.push(`table row ${w}: a release-reason pattern not on releaseReasons`);
      continue;
    }
    const mapped = w in d.waveMap;
    if (route.has(w) && mapped) out.push(`${w}: a route refusal now; take it off the wave map in this pull request`);
    else if (!route.has(w) && !mapped) out.push(`${w}: in Table 11.6, and neither a route refusal nor on the wave map`);
  }
  for (const [w, wave] of Object.entries(d.waveMap)) {
    if (!inTable.has(w)) out.push(`${w}: on the wave map, and Table 11.6 has no such row`);
    if (!WAVES.has(wave)) out.push(`${w}: on the wave map with ${wave}, which is not one of ${[...WAVES].join(', ')}`);
  }
  for (const [w, wave] of Object.entries(d.releaseReasons)) {
    if (!inTable.has(w)) out.push(`${w}: on releaseReasons, and Table 11.6 has no such row`);
    if (!WAVES.has(wave)) out.push(`${w}: on releaseReasons with ${wave}, which is not a wave`);
  }
  for (const w of overlord) {
    if (!inTable.has(w) && !(w in d.codeOnly)) out.push(`${w}: an Overlord word that Table 11.6 lacks and codeOnly does not name`);
  }
  for (const w of Object.keys(d.codeOnly)) {
    if (inTable.has(w)) out.push(`${w}: on codeOnly, and Table 11.6 now has it; take it off codeOnly`);
    if (!overlord.has(w)) out.push(`${w}: on codeOnly, and no Overlord group holds it`);
  }
  return out;
}

/** `codeOnly` may only shrink (F5): its words at the merge base with `origin/main` are a superset of today's. The base is
 *  resolved first, and an unresolvable base is red ("fetch origin main"), never a skip; a file absent at the base is the
 *  pull request that creates the list, and is skipped with a warning. */
export function shrinkFindings(
  resolveBase: () => string | null, readAtBase: (base: string) => string | 'absent', now: Data,
): string[] {
  const base = resolveBase();
  if (base === null) return ['codeOnly\'s shrink check could not resolve the merge base with origin/main: fetch origin main'];
  const text = readAtBase(base);
  if (text === 'absent') {
    console.warn(`refusal-table: ${DATA} is absent at the merge base ${base.slice(0, 12)}; the shrink check is skipped`);
    return [];
  }
  const was = new Set(Object.keys((JSON.parse(text) as Data).codeOnly));
  return Object.keys(now.codeOnly).filter((w) => !was.has(w))
    .map((w) => `${w}: codeOnly grew against the merge base; it may only shrink`);
}

const git = (args: string[]): { status: number | null; stdout: string } => {
  const r = spawnSync('git', args, { cwd: ccrcRoot, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout };
};
const realBase = (): string | null => {
  const r = git(['merge-base', 'origin/main', 'HEAD']);
  return r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim()) ? r.stdout.trim() : null;
};
const realReadAtBase = (base: string): string | 'absent' => {
  if (git(['cat-file', '-e', `${base}:${DATA}`]).status !== 0) return 'absent';
  const r = git(['show', `${base}:${DATA}`]);
  if (r.status !== 0) throw new Error(`git show ${base}:${DATA} failed`);
  return r.stdout;
};

/** Every exported `*_REFUSALS` binding of `files` (each `{file, text}`) whose leading doc comment names the Overlord. */
export function discoverOverlordGroups(files: ReadonlyArray<{ file: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { file, text } of files) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      if (!(ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const comment = (ts.getLeadingCommentRanges(text, st.pos) ?? []).map((r) => text.slice(r.pos, r.end)).join('\n');
      if (!/\bOverlord\b/.test(comment)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && /_REFUSALS$/.test(d.name.text)) out.push(d.name.text);
      }
    }
  }
  return out.sort();
}

const sharedTs = (): Array<{ file: string; text: string }> =>
  readdirSync(path.join(ccrcRoot, 'shared')).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => ({ file: `shared/${f}`, text: readFileSync(path.join(ccrcRoot, 'shared', f), 'utf8') }));

/** The W1 group, as the plan's Task 3 table gives it: each word with its status, chosen by the family rule. */
const W1_GROUP: Readonly<Record<string, number>> = {
  'not-the-overlord': 403, 'capability-missing': 501, 'overlord-off': 409, 'rung-below': 403, 'overlord-exists': 409,
  'overlord-body-alive': 409, 'overlord-single-account': 409, 'overlord-sandbox-unmet': 409, 'launch-profile-unmet': 409,
  'authority-rolled-back': 503, 'stale-designation': 409, 'stale-generation': 409, 'card-unread': 409, 'unwitnessed': 409,
  'overlord-uses-its-doors': 403, 'overlord-not-a-coordinator': 403, 'history-unreachable': 503, 'read-ceiling': 429,
};

/** The W2 group, as the W2 vocabulary plan's Table V1 gives it: each word with its status, chosen by the family rule. */
const W2_GROUP: Readonly<Record<string, number>> = {
  'act-ceiling': 429, 'dependency-cycle': 409, 'egress-refused': 403, 'goal-conflict-open': 409, 'identity-too-weak': 403,
  'operator-has-it': 409, 'operator-only': 403, 'relay-carries-method': 400, 'request-not-yours': 403,
  'said-not-operator': 409, 'server-not-isolated': 409,
};

const data = (): Data => JSON.parse(readFileSync(path.join(ccrcRoot, DATA), 'utf8')) as Data;
const overlordWords = (): Set<string> => new Set(Object.values(OVERLORD_GROUPS).flat());

describe('Table 11.6 and the code agree, both ways (spec §11.6, Appendix B)', () => {
  const spec = readFileSync(path.join(ccrcRoot, SPEC), 'utf8');
  const table = tableWords(spec);
  const route = new Set<string>(ROUTE_REFUSALS);

  it('the table parses whole: its header, at least 70 rows, each a backquoted word', () => {
    expect(table.length).toBeGreaterThanOrEqual(MIN_ROWS);
    expect(new Set(table).size).toBe(table.length);
  });

  it('every table word is a route refusal, on the wave map, or a release-reason pattern; and every Overlord word is in the table or on codeOnly', () => {
    expect(tableFindings(table, route, overlordWords(), data())).toEqual([]);
  });

  it('the wave map holds no W1 or W2 word and no word of the Overlord group', () => {
    const d = data();
    for (const [w, wave] of Object.entries(d.waveMap)) {
      expect(wave, w).not.toBe('W1');
      expect(wave, w).not.toBe('W2');
      expect(w in OVERLORD_REFUSALS, w).toBe(false);
    }
  });

  it('codeOnly may only shrink against the merge base with origin/main (F5)', () => {
    expect(shrinkFindings(realBase, realReadAtBase, data())).toEqual([]);
  });

  it('every exported *_REFUSALS group of shared/ whose doc comment names the Overlord is registered in OVERLORD_GROUPS (F4)', () => {
    expect(discoverOverlordGroups(sharedTs())).toEqual(Object.keys(OVERLORD_GROUPS).filter((k) => !k.includes('#')).sort());
  });

  describe('CONTROLS: each planted drift reds', () => {
    const d = data();
    const red = (f: string[]): void => { expect(f.length).toBeGreaterThan(0); };
    it('a W1 word dropped from the group', () => {
      const r = new Set(route); r.delete('history-unreachable');
      const o = overlordWords(); o.delete('history-unreachable');
      red(tableFindings(table, r, o, d));
    });
    it('a W2 word dropped from the group', () => {
      const r = new Set(route); r.delete('egress-refused');
      const o = overlordWords(); o.delete('egress-refused');
      red(tableFindings(table, r, o, d));
    });
    it('a W2 word put back on the wave map under W2', () => {
      const f = tableFindings(table, route, overlordWords(), { ...d, waveMap: { ...d.waveMap, 'act-ceiling': 'W2' } });
      expect(f).toContain('act-ceiling: on the wave map with W2, which is not one of W1a, W3, W4, W4b, W5, W6');
      expect(f).toContain('act-ceiling: a route refusal now; take it off the wave map in this pull request');
    });
    // Each plants a wave still in WAVES, and asserts its own finding, so neither reds through the wave-list finding alone.
    it('a route word put on the wave map', () => {
      expect(tableFindings(table, route, overlordWords(), { ...d, waveMap: { ...d.waveMap, 'rung-below': 'W3' } }))
        .toEqual(['rung-below: a route refusal now; take it off the wave map in this pull request']);
    });
    it('a map entry the table no longer has', () => {
      expect(tableFindings(table, route, overlordWords(), { ...d, waveMap: { ...d.waveMap, 'no-such-word': 'W3' } }))
        .toEqual(['no-such-word: on the wave map, and Table 11.6 has no such row']);
    });
    it('a map entry under a wave outside the closed list, W1 included', () => {
      red(tableFindings(table, route, overlordWords(), { ...d, waveMap: { ...d.waveMap, defer: 'W1' } }));
      red(tableFindings(table, route, overlordWords(), { ...d, waveMap: { ...d.waveMap, defer: 'W9' } }));
    });
    it('a codeOnly entry the table now has', () => red(tableFindings(table, route, overlordWords(), { ...d, codeOnly: { ...d.codeOnly, 'card-changed': 'x' } })));
    it('an Overlord word neither in the table nor on codeOnly', () => {
      red(tableFindings(table, route, new Set([...overlordWords(), 'planted-word']), d));
    });
    it('a release-reason pattern missing from releaseReasons', () => {
      const { ['server-gap']: _gone, ...rest } = d.releaseReasons;
      red(tableFindings(table, route, overlordWords(), { ...d, releaseReasons: rest }));
    });
    it('codeOnly grown against a stand-in merge base', () => {
      // The control plants its own word, so it reds whatever the live list holds, an empty one included.
      const grown = { ...d, codeOnly: { ...d.codeOnly, 'planted-word': 'a control' } };
      red(shrinkFindings(() => 'f'.repeat(40), () => JSON.stringify(d), grown));
      expect(shrinkFindings(() => 'f'.repeat(40), () => JSON.stringify(d), d)).toEqual([]);
    });
    it('an unresolvable merge base reds rather than skips', () => {
      expect(shrinkFindings(() => null, () => { throw new Error('never read'); }, d)).toEqual([
        'codeOnly\'s shrink check could not resolve the merge base with origin/main: fetch origin main',
      ]);
    });
    it('a renamed caption, another header row and a short table each throw', () => {
      expect(() => tableWords(spec.replace('\n*Table 11.6.', '\n*Table 11.7.'))).toThrow(/caption/);
      expect(() => tableWords(spec.replace(HEADER, '| Word | Door | Meaning | Call |'))).toThrow(/header/);
      const lines = spec.split('\n');
      const from = lines.indexOf(HEADING);
      const cut = lines.filter((l, i) => !(i > from + 20 && i < from + 80 && l.startsWith('| `')));
      expect(() => tableWords(cut.join('\n'))).toThrow(/fewer than/);
      expect(() => tableWords('')).toThrow(/heading/);
    });
    it('a planted Overlord group that OVERLORD_GROUPS does not register', () => {
      const planted = { file: 'shared/planted.ts', text: "/** The Overlord's planted words. */\nexport const PLANTED_REFUSALS = { a: 'b' } as const;\n" };
      expect(discoverOverlordGroups([planted])).toEqual(['PLANTED_REFUSALS']);
      expect(discoverOverlordGroups([...sharedTs(), planted])).not.toEqual(Object.keys(OVERLORD_GROUPS).filter((k) => !k.includes('#')).sort());
    });
  });
});

describe('OVERLORD_REFUSALS: complete, alone, and each status by the family rule', () => {
  it('its words are exactly the W1 rows of the plan\'s Task 3 table and read-ceiling, and the W2 rows of Table V1, each with its status', () => {
    expect({ ...OVERLORD_REFUSALS }).toEqual({ ...W1_GROUP, ...W2_GROUP });
  });

  it('OVERLORD_REFUSAL_WORDS is the group\'s own keys', () => {
    expect(OVERLORD_REFUSAL_WORDS).toEqual(Object.keys(OVERLORD_REFUSALS));
  });

  it('every word is a route refusal with its status in REFUSAL_STATUS', () => {
    for (const [w, status] of Object.entries(OVERLORD_REFUSALS)) {
      expect(ROUTE_REFUSALS, w).toContain(w);
      expect((REFUSAL_STATUS as Readonly<Record<string, number>>)[w], w).toBe(status);
    }
  });

  it('isOverlordRefusal answers its words only, never an inherited name or a non-string', () => {
    for (const w of OVERLORD_REFUSAL_WORDS) expect(isOverlordRefusal(w), w).toBe(true);
    for (const v of ['constructor', 'toString', '', 'card-changed', 42, null, undefined, ['rung-below']]) {
      expect(isOverlordRefusal(v), String(v)).toBe(false);
    }
  });

  it('no other route-refusal group holds one of its words (F18)', () => {
    const mine = new Set<string>(OVERLORD_REFUSAL_WORDS);
    const wordsOf = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
      if (v === null || typeof v !== 'object') return [];
      const values = Object.values(v as Record<string, unknown>);
      return values.every((x) => typeof x === 'number') ? Object.keys(v) : values.filter((x): x is string => typeof x === 'string');
    };
    const holders: string[] = [];
    for (const [name, value] of Object.entries(refusal)) {
      if (name === 'OVERLORD_REFUSALS' || name === 'OVERLORD_REFUSAL_WORDS' || name === 'REFUSAL_STATUS' || name === 'ROUTE_REFUSALS') continue;
      if (!/_REFUSALS$|_REFUSAL_STATUS$/.test(name)) continue;
      for (const w of wordsOf(value)) if (mine.has(w)) holders.push(`${name}: ${w}`);
    }
    for (const w of GENERIC_REFUSALS) if (mine.has(w)) holders.push(`GENERIC_REFUSALS: ${w}`);
    expect(holders).toEqual([]);
  });

  it('REFUSAL_STATUS takes each word from the group\'s spread alone: no literal key and no other spread names one', () => {
    const text = readFileSync(path.join(ccrcRoot, 'shared/refusal.ts'), 'utf8');
    const sf = ts.createSourceFile('refusal.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let init: ts.ObjectLiteralExpression | undefined;
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'REFUSAL_STATUS' && d.initializer && ts.isObjectLiteralExpression(d.initializer)) init = d.initializer;
      }
    }
    expect(init, 'REFUSAL_STATUS is an object literal').toBeDefined();
    const mine = new Set<string>(OVERLORD_REFUSAL_WORDS);
    const literal: string[] = [];
    const spreads: string[] = [];
    for (const p of init!.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && mine.has(p.name.text)) literal.push(p.name.text);
      if (ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression)) spreads.push(p.expression.text);
    }
    expect(literal).toEqual([]);
    expect(spreads).toContain('OVERLORD_REFUSALS');
    // The modules refusal.ts spreads from; a spread from any other module is red until it is named here.
    const modules: Array<Record<string, unknown>> = [refusal, api, delegationAdopt] as Array<Record<string, unknown>>;
    for (const s of spreads.filter((x) => x !== 'OVERLORD_REFUSALS')) {
      const v = modules.map((m) => m[s]).find((x) => x !== undefined);
      expect(v, `the spread ${s} resolves in refusal.ts, api.ts or delegation-adopt.ts`).toBeDefined();
      for (const w of Object.keys(v as object)) expect(mine.has(w), `${s} spreads ${w}`).toBe(false);
    }
  });
});

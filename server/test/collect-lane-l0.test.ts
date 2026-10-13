// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2, §5.6, §5.7): the L0 vocabulary of the collector switch
// in Settings, appended at the foot of `shared/api.ts`.
// - `isCollectLaneChoice` is the one choice guard. Its body is pinned: an `in` test admits every key of
//   `Object.prototype`, and a stored `toString` must never read as a choice.
// - `COLLECT_LANE_REFUSALS` holds the route's nine refusal words. They are derived from a total table and sit behind a
//   guard of the same pinned form.
// - `CollectLaneView` and `CollectLaneConfirmRequired` are the wire shapes. The last case's `@ts-expect-error` lines are
//   compile-time facts: `typecheck-tests.test.ts` compiles this directory under `test/tsconfig.tests.json`, so an unused
//   directive is a red suite, not a comment.
// - The block sits below every line README and the frozen corpus cite, and `shared/api.ts` still imports nothing at
//   run time.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECT_LANE_CHOICES, COLLECT_LANE_REFUSALS, isCollectLaneChoice, isCollectLaneRefusal,
  type CollectArmedBy, type CollectLaneChoice, type CollectLaneConfirmRequired, type CollectLaneRefusal,
  type CollectLaneRequest, type CollectLaneView,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(here, '..', '..', 'shared', 'api.ts');
const api = (): string => readFileSync(apiPath, 'utf8');

/** Removes comment lines, as `single-definition.test.ts`'s `stallCodeText` filter does: a sentence about a name never
 *  counts as spelling it on a code line. */
const codeLines = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));

const PROTOTYPE_NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'] as const;

/** The route's nine words (path-identity spec §5.6), in the table's order. */
const NINE = [
  'bad-request', 'not-configured', 'sign-in-unarmed', 'confirm-required', 'confirm-stale',
  'marker-still-controls', 'conflict', 'state-unmeasurable', 'write-failed',
] as const;

/** Wave 9's foot. Every name this block declares must stand below it. */
const FOOT = '\nexport const COLLECT_BOX_LINES: readonly CollectBoxLine[] = ';

/** The head of each declaration the block adds. Each must appear exactly once, below `FOOT`. */
const DECLARATIONS: readonly string[] = [
  '^export type CollectLaneChoice = ',
  '^const COLLECT_LANE_CHOICE_TABLE: ',
  '^export const COLLECT_LANE_CHOICES: ',
  '^export function isCollectLaneChoice\\(',
  '^export type CollectArmedBy = ',
  '^export interface CollectLaneRequest\\b',
  '^export type CollectLaneRefusal =',
  '^const COLLECT_LANE_REFUSAL_TABLE: ',
  '^export const COLLECT_LANE_REFUSALS: ',
  '^export function isCollectLaneRefusal\\(',
  '^export interface CollectLaneView\\b',
  '^export interface CollectLaneConfirmRequired\\b',
];

/** `peers-claims-l0.test.ts`'s four lines. The block adds none. */
const IMPORTS = [
  "import type { Hue } from './roster.js';",
  "import type { AccountPoolWire } from './poolrule.js';",
  "import type { BuildInfo } from './buildinfo.js';",
  "import type { BoxTokenView } from './box-token.js';",
];

describe("the collector switch's L0 vocabulary (path-identity spec §5.7)", () => {
  it('isCollectLaneChoice accepts off and live and nothing else', () => {
    expect(isCollectLaneChoice('off')).toBe(true);
    expect(isCollectLaneChoice('live')).toBe(true);
    // `LIVE` is a future token and `shadowed` a state word. A stored row may carry either: both read, and neither is a choice.
    for (const v of ['LIVE', 'shadowed', '', ' live', 'live ', 'Off', 1, null, undefined, {}]) {
      expect(isCollectLaneChoice(v), String(v)).toBe(false);
    }
  });

  it('isCollectLaneChoice refuses every prototype name', () => {
    for (const v of PROTOTYPE_NAMES) expect(isCollectLaneChoice(v), v).toBe(false);
  });

  it('its body is the includes form', () => {
    const src = api();
    for (const [fn, type, list] of [
      ['isCollectLaneChoice', 'CollectLaneChoice', 'COLLECT_LANE_CHOICES'],
      ['isCollectLaneRefusal', 'CollectLaneRefusal', 'COLLECT_LANE_REFUSALS'],
    ] as const) {
      const body = new RegExp(`export function ${fn}\\(v: unknown\\): v is ${type} \\{\\n([\\s\\S]*?)\\n\\}`).exec(src)?.[1];
      expect(body, `${fn}'s body`).toBe(`  return typeof v === 'string' && (${list} as readonly string[]).includes(v);`);
      expect(body, `${fn} tests membership with \`in\` or \`MAP[v]\``).not.toMatch(/\bin\b|\[v\]/);
    }
  });

  it('COLLECT_LANE_CHOICES is derived from its table', () => {
    expect(COLLECT_LANE_CHOICES).toEqual(['off', 'live']);
    // Totality is checked at compile time in both directions: TS2741 if the union gains a member this literal lacks,
    // and TS2353 if it loses one.
    const total: Record<CollectLaneChoice, true> = { off: true, live: true };
    expect(Object.keys(total)).toEqual([...COLLECT_LANE_CHOICES]);
    const src = api();
    expect(src, 'COLLECT_LANE_CHOICES is not Object.keys of its table').toMatch(
      /^export const COLLECT_LANE_CHOICES: readonly CollectLaneChoice\[\] =\s*\n?\s*Object\.keys\(COLLECT_LANE_CHOICE_TABLE\) as CollectLaneChoice\[\];$/m);
    expect(src, 'COLLECT_LANE_CHOICES is hand-typed as a literal array')
      .not.toMatch(/^export const COLLECT_LANE_CHOICES\b[^=\n]*=\s*\[/m);
    expect(src, 'the choice table is exported or reshaped: one value, one name')
      .toMatch(/^const COLLECT_LANE_CHOICE_TABLE: Readonly<Record<CollectLaneChoice, true>> = \{ off: true, live: true \};$/m);
  });

  it('isCollectLaneRefusal admits exactly the nine route words', () => {
    expect(COLLECT_LANE_REFUSALS).toEqual([...NINE]);
    for (const w of NINE) expect(isCollectLaneRefusal(w), w).toBe(true);
    // `not-found` is a real refusal word of other routes, and must not be smuggled in by proximity.
    for (const v of ['toString', 'conflict ', ...PROTOTYPE_NAMES, 'Conflict', 'confirm_required', 'not-found', '', 1,
      null, undefined, {}]) {
      expect(isCollectLaneRefusal(v), String(v)).toBe(false);
    }
    const total: Record<CollectLaneRefusal, true> = {
      'bad-request': true, 'not-configured': true, 'sign-in-unarmed': true, 'confirm-required': true,
      'confirm-stale': true, 'marker-still-controls': true, conflict: true, 'state-unmeasurable': true,
      'write-failed': true,
    };
    expect(Object.keys(total)).toEqual([...COLLECT_LANE_REFUSALS]);
    const src = api();
    expect(src, 'COLLECT_LANE_REFUSALS is not Object.keys of its table').toMatch(
      /^export const COLLECT_LANE_REFUSALS: readonly CollectLaneRefusal\[\] =\s*\n?\s*Object\.keys\(COLLECT_LANE_REFUSAL_TABLE\) as CollectLaneRefusal\[\];$/m);
    expect(src, 'COLLECT_LANE_REFUSALS is hand-typed as a literal array')
      .not.toMatch(/^export const COLLECT_LANE_REFUSALS\b[^=\n]*=\s*\[/m);
  });

  it('the block sits at the foot, and L0 still imports nothing', () => {
    const src = api();
    const foot = src.indexOf(FOOT);
    expect(foot, "the wave-9 foot's anchor moved: re-point by content").toBeGreaterThan(0);
    for (const head of DECLARATIONS) {
      const hits = [...src.matchAll(new RegExp(head, 'gm'))];
      expect(hits.length, `${head} is declared ${hits.length} times`).toBe(1);
      expect(hits[0]!.index, `${head} is declared above the foot`).toBeGreaterThan(foot);
    }
    expect(src.split('\n').filter((l) => /^\s*import\b/.test(l))).toEqual(IMPORTS);
    expect(src, 'a runtime import, a require or a re-export')
      .not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s*(?:\*|\{[^}]*\})\s*from\s/m);
  });

  it('no L0 code line spells the marker', () => {
    const MARKER = 'collect-lane-live';
    // CONTROL: the filter keeps a code line that spells it and drops a docstring line about it, so the scan is not vacuous.
    expect(codeLines(`export const X = '${MARKER}';\n *  the ${MARKER} file`)).toEqual([`export const X = '${MARKER}';`]);
    expect(codeLines(api()).filter((l) => l.includes(MARKER))).toEqual([]);
  });

  it('the wire shapes compile as the spec draws them: no absent row, and no nonce or epoch on the facts', () => {
    const view: CollectLaneView = {
      stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 },
      journal: { read: 'missing' },
      control: { state: 'coherent', bootstrap: true },
      effective: { state: 'shadowed', armedBy: 'neither' },
      marker: { listing: 'absent', latch: 'unset' },
      node: { state: 'known', nodeId: 'node-a', measuredAt: 1, stored: 'none' },
      caps: { collect: true, reclaimPause: true },
      attention: null,
      remedy: null,
      notice: null,
    };
    // @ts-expect-error an absent row never reaches a view: the route answers 503 for it (path-identity spec §5.6)
    const absent: CollectLaneView['stored'] = { read: 'absent' };
    const facts: CollectLaneConfirmRequired['facts'] = {
      node: { nodeId: 'node-a', measuredAt: 1 }, caps: { collect: true, reclaimPause: false }, paused: false,
      marker: 'stands', repair: 'journal-ahead', attention: { wouldCollect: 2, held: 1, boxLines: 0 },
    };
    const noEpoch: CollectLaneConfirmRequired['facts'] = {
      node: { nodeId: 'node-a', measuredAt: 1 }, caps: { collect: true, reclaimPause: true }, paused: false,
      marker: 'absent', repair: null, attention: null,
      // @ts-expect-error the confirm key covers the connection epoch, and the wire never carries it (§5.6)
      epoch: 1,
    };
    const noBoot: CollectLaneConfirmRequired['facts'] = {
      node: { nodeId: 'node-a', measuredAt: 1 }, caps: { collect: true, reclaimPause: true }, paused: true,
      marker: 'absent', repair: null, attention: null,
      // @ts-expect-error the confirm key covers the server's boot nonce, and the wire never carries it (§5.6)
      boot: 'nonce',
    };
    const confirm: CollectLaneConfirmRequired = { ok: false, error: 'confirm-stale', confirmKey: '0123abcd', facts };
    // @ts-expect-error `shadowed` is a state, never a choice a request may carry (§5.2)
    const bad: CollectLaneRequest = { choice: 'shadowed' };
    const req: CollectLaneRequest = { choice: 'live', confirm: '0123abcd' };
    // Totality of the arming source, both directions, at compile time (§5.7).
    const armed: Record<CollectArmedBy, true> = { settings: true, 'legacy-marker': true, both: true, neither: true };
    expect(Object.keys(armed)).toEqual(['settings', 'legacy-marker', 'both', 'neither']);
    expect([view.stored.read, absent.read, noEpoch.paused, noBoot.paused, confirm.error, bad.choice, req.choice])
      .toEqual(['row', 'absent', false, true, 'confirm-stale', 'shadowed', 'live']);
  });
});

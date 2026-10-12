// Child reclamation wave 9 (spec §5.9, §5.10): the L0 the temp-root collector's server lane adds.
// - `isTmpRootId` is the ONE predicate of a temp-root id. It gates every argv the lane composes, and wave 8's
//   kept-leaf reader asks it before it names a leaf.
// - `CollectToken` is the only type `ws-collect`'s builder takes.
// - The collector's two attention arms join `ChildReclaimAttention`.
// - `COLLECT_BOX_LABELS` names each box-wide line with a label no session id can equal.
// Only declarations are here, plus the kept-leaf reader's display-only change. The lane's own pins live where it
// composes (Tasks 3 and 6). The type cases are compile-time facts, so `typecheck-tests.test.ts` is half of this file.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_KEPT_WORDS, COLLECT_BOX_LABELS, COLLECT_BOX_LINES, TMPROOT_ID_MAX_CHARS, isSessionIdShape, isTmpRootId,
  type ChildReclaimAttention, type ChildReclaimCollectMany, type CollectToken, type LifecycleOutcome,
} from '../../shared/api.js';
import { reviveMeas } from '../src/coord/journalparse.js';
import { childReclaimLeafKept, type ChildReclaimLeafSourceRow } from '../src/childReclaimSweep.js';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

describe('isTmpRootId — the one predicate of a temp-root id (spec §5.10)', () => {
  it('its cap is 255 characters, one file name component', () => {
    expect(TMPROOT_ID_MAX_CHARS).toBe(255);
  });

  // ccd's destructive verbs read their decision flags from any position, `--session`'s value included. Every such
  // flag begins `--`, so an id that begins `-` could be read as one.
  it.each(['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'])(
    'a dash-leading id %j is refused, so no argv can carry it as a flag', (id) => {
      expect(isTmpRootId(id)).toBe(false);
    });

  it.each<readonly [string, unknown, boolean]>([
    ['an ordinary child id', 'demo-quiet-mesa', true],
    ['a nested id with dots', 'demo.quiet.mesa', true],
    ['dashes inside', 'a--actor', true],
    ['a dot, then dashes', 'a.--actor', true],
    ['exactly 255 characters', 'a'.repeat(255), true],
    ['256 characters', 'a'.repeat(256), false],
    ['a flag with its value (the shape refuses =)', '--actor=x', false],
    ['.', '.', false],
    ['..', '..', false],
    ['a dot-leading name', '.hidden', false],
    ['the empty string', '', false],
    ['a space', 'demo gone', false],
    ['a slash', 'x/../y', false],
    ['a trailing newline', 'demo\n', false],
    ['null', null, false],
    ['a number', 3, false],
    ['undefined', undefined, false],
    ['an object', {}, false],
  ])('%s -> %s', (_what, id, ok) => {
    expect(isTmpRootId(id)).toBe(ok);
  });

  it('narrows an unknown to a string', () => {
    const v: unknown = 'demo-quiet-mesa';
    expect(isTmpRootId(v) ? v.length : -1).toBe(15);
  });
});

let mid = 1000;
/** A `reclaim` `done` row that kept the temp root, for `id`: the shape wave 8's kept-leaf reader lists. */
const keptRow = (sessionId: string): ChildReclaimLeafSourceRow => ({
  id: (mid += 1), sessionId, at: NOW - DAY, outcome: 'done' as LifecycleOutcome, refusal: null, truncated: false,
  meas: reviveMeas({ childOf: '41', tmpRootKept: 'in-use' }), detail: null,
});
const listed = (ids: readonly string[]): string[] =>
  childReclaimLeafKept({ rows: ids.map(keptRow), ends: new Map(), nowMs: NOW }).map((k) => k.item.sessionId).sort();

describe('wave 8’s kept-leaf reader asks the same predicate: a display-only change (spec §5.9)', () => {
  it('a dash-leading or over-long id is not listed, so no feed row is written for it', () => {
    expect(listed(['--actor', '-x', '--', 'a'.repeat(256)])).toEqual([]);
  });

  it('every id it listed before still lists: dashes inside, a dot then dashes, 255 characters', () => {
    const ids = ['a--actor', 'a.--actor', 'a'.repeat(255), 'demo-gone'];
    expect(listed(ids)).toEqual([...ids].sort());
  });
});

describe('CollectToken — the one type ws-collect’s builder takes (spec §5.10)', () => {
  it('is a string underneath, and a plain string is not one', () => {
    const minted = 'b'.repeat(64) as CollectToken; // a test-only cast: the shipped tree's one cast is parseCollectAudit's
    const plain: string = minted;
    // @ts-expect-error a plain string is not a CollectToken
    const forged: CollectToken = 'b'.repeat(64);
    expect([plain, forged]).toEqual(['b'.repeat(64), 'b'.repeat(64)]);
  });
});

describe('the collector’s ChildReclaimAttention arms (spec §5.9)', () => {
  it('a per-id item and a box-wide line are members of the union, and neither carries an at', () => {
    const one: ChildReclaimAttention = { kind: 'collect', sessionId: 'demo-quiet-mesa', runId: 41, word: 'in-use', sentence: 's' };
    const box: ChildReclaimAttention = { kind: 'collect', sessionId: COLLECT_BOX_LABELS['box-probe'], runId: null, word: 'box-probe', sentence: 's' };
    // @ts-expect-error the collector's item is built from the server's memory, so it carries no ccd clock
    const dated: ChildReclaimAttention = { kind: 'collect', sessionId: 'x', runId: null, word: 'w', sentence: 's', at: 1 };
    expect([one.kind, box.kind, dated.kind]).toEqual(['collect', 'collect', 'collect']);
  });

  it('a collapsed collector line is a kept-many whose word no other collapsed line uses', () => {
    const many: ChildReclaimAttention = {
      kind: 'kept-many', word: 'collect:in-use', members: [{ sessionId: 'demo-a', runId: 1 }], sentence: 's',
    };
    // @ts-expect-error a collapsed collector line's word must carry the `collect:` prefix (spec §5.10)
    const unprefixed: ChildReclaimCollectMany = { kind: 'kept-many', word: 'in-use', members: [], sentence: 's' };
    expect([many.kind, unprefixed.kind]).toEqual(['kept-many', 'kept-many']);
    // The banner keys a collapsed line by `kept-many <word>`: no kept word, and not the kept leaves' word, may share it.
    for (const w of [...CHILD_RECLAIM_KEPT_WORDS, 'leaf-kept']) expect(w.startsWith('collect:'), w).toBe(false);
  });
});

describe('COLLECT_BOX_LABELS — the box-wide lines’ fixed sessionIds (spec §5.9)', () => {
  it('the lines are the table’s keys, derived, ten of them', () => {
    expect([...COLLECT_BOX_LINES].sort()).toEqual(Object.keys(COLLECT_BOX_LABELS).sort());
    expect(COLLECT_BOX_LINES).toHaveLength(10);
  });

  it.each(Object.keys(COLLECT_BOX_LABELS))('%s: holds a slash, which no registry file name can carry, so no session id and no temp-root id equals it', (line) => {
    const label = COLLECT_BOX_LABELS[line as keyof typeof COLLECT_BOX_LABELS];
    expect(label).toMatch(/\//);
    expect(isSessionIdShape(label)).toBe(false);
    expect(isTmpRootId(label)).toBe(false);
  });

  it('no two lines share a label, because the banner keys a single line by its sessionId', () => {
    expect(new Set(Object.values(COLLECT_BOX_LABELS)).size).toBe(COLLECT_BOX_LINES.length);
  });

  it('each listing is named by its path, and the box-wide probe line by the box', () => {
    expect(COLLECT_BOX_LABELS.tmproots).toBe('~/.cc-sessions/tmproots');
    expect(COLLECT_BOX_LABELS.tmpquarantine).toBe('~/.cc-sessions/tmpquarantine');
    expect(COLLECT_BOX_LABELS['box-probe']).toBe('collector / the fleet box');
  });
});

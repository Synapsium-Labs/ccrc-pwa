// §1.6b. `_spawn_settle` already writes `$REG/<id>.spawn` as `<epoch-seconds> <rc>`, and
// `registry.ts` already parses it into `SessionRecord.spawn: { at, rc } | null`. This is the ONE
// derivation of that rc table into a word, in L0, so the wire and the PWA cannot mint a second.
import { describe, it, expect } from 'vitest';
import { SPAWN_VERDICTS, isSpawnVerdict, spawnVerdict } from '../../shared/api.js';

describe('spawnVerdict — ccd\'s shipped rc table, and nothing else', () => {
  it('maps every rc ccd actually writes', () => {
    expect(spawnVerdict(0)).toBe('ready');
    expect(spawnVerdict(2)).toBe('login');
    expect(spawnVerdict(3)).toBe('vanished');
    expect(spawnVerdict(4)).toBe('expired');
    expect(spawnVerdict(5)).toBe('blocked');
  });

  it('answers null for NOT RECORDED — never `ready`, never a warning', () => {
    // `swift-harbor` has no `$REG/<id>.spawn` at all. A null that laundered into
    // `ready` would assert a measurement nobody made; a null that laundered into a
    // warning would light every row that has not spawned since PR #50.
    expect(spawnVerdict(null)).toBeNull();
  });

  it('lands an rc this build never heard of on the designated-ignorance member, never a throw', () => {
    // rc 1 is a ccd `die` and belongs here deliberately: `die` is a whole family of
    // refusals, not one verdict, so giving it a word would be inventing a distinction
    // ccd does not make.
    expect(spawnVerdict(1)).toBe('unrecognised');
    expect(spawnVerdict(99)).toBe('unrecognised');
    expect(spawnVerdict(-1)).toBe('unrecognised');
  });

  it('derives SPAWN_VERDICTS from the map, and the list is the whole union', () => {
    expect([...SPAWN_VERDICTS].sort()).toEqual(
      ['blocked', 'expired', 'login', 'ready', 'unrecognised', 'vanished'],
    );
  });

  it('isSpawnVerdict accepts every member and rejects a stray token or a non-string', () => {
    for (const v of SPAWN_VERDICTS) expect(isSpawnVerdict(v)).toBe(true);
    expect(isSpawnVerdict('spawnstate')).toBe(false);
    expect(isSpawnVerdict('')).toBe(false);
    expect(isSpawnVerdict(0)).toBe(false);
    expect(isSpawnVerdict(null)).toBe(false);
    expect(isSpawnVerdict(undefined)).toBe(false);
  });

  it('does NOT renumber 3 or 4 — four ccd call sites plus _supervised_start branch on them', () => {
    expect(spawnVerdict(3)).toBe('vanished');
    expect(spawnVerdict(4)).toBe('expired');
    expect(spawnVerdict(5)).not.toBe(spawnVerdict(4));
  });
});

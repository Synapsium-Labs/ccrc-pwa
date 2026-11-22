// A session behind its class's alias (model-class follow-up typed-repick): doctor's `aliasSessionBehind`
// (`shared/model-aliases.mjs`), pinned input for input BEFORE its age-free half moves into the predicate the automatic roll
// shares. Every case below was green against `main`'s code first; the move changes nothing this file asserts.
import { describe, expect, it } from 'vitest';
import { aliasSessionBehind, type AliasClass, type Aliases, type AliasSession } from '../../shared/model-aliases.mjs';
import type { ClassAdvance } from '../../shared/model-advance.mjs';
import { CLASSES, type ModelClass } from '../../shared/models.mjs';

const X0 = 'claude-opus-9-0';
const X1 = 'claude-opus-9-1';
const X2 = 'claude-opus-9-2';
const S1 = 'claude-sonnet-9-1';
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** The class moved two days ago, so a turn one day ago came after it and the 24 hours have passed. */
const MOVED = iso(NOW - 2 * DAY);
const TURN = NOW - DAY;

const row = (id: string) => ({ id, label: null, efforts: null, defaultEffort: null, minVersion: null });

function cls(o: Partial<AliasClass> = {}): AliasClass {
  return {
    id: null, source: null, evidenceAt: null, idSince: null, cacheTarget: null, seenId: null, seenAt: null,
    unobserved: false, unlaunchable: null, row: null, rowFrom: null, heldRow: null, orphaned: null, ...o,
  };
}

function lane(over: Partial<Record<ModelClass, Partial<AliasClass>>> = {}): Aliases {
  const classes = {} as Record<ModelClass, AliasClass>;
  for (const c of CLASSES) classes[c] = cls(over[c] ?? {});
  return { v: 1, at: iso(NOW), cache: { fetchedAt: iso(NOW), format: 'current' }, stale: false, classes };
}

function adv(o: Partial<ClassAdvance> = {}): ClassAdvance {
  return { family: null, hold: null, previous: null, history: [], ...o } as ClassAdvance;
}

const session = (o: Partial<AliasSession> = {}): AliasSession =>
  ({ cls: 'opus', model: X1, renderMs: TURN + 60_000, turnAtMs: TURN, ...o });

/** The usual lane: opus moved to X2 two days ago, sonnet on S1. */
const L = lane({ opus: { id: X2, idSince: MOVED, seenId: X2 }, sonnet: { id: S1, idSince: MOVED } });
const ask = (s: AliasSession, l: Aliases = L, a: ClassAdvance = adv(), c: ModelClass = 'opus') =>
  aliasSessionBehind(s, l.classes[c], a, l, NOW);

describe('aliasSessionBehind, as doctor reads it today', () => {
  it('a session on the id its class left, a day after the move, is behind, with every field', () => {
    expect(ask(session())).toEqual({
      class: 'opus', from: X1, to: X2, movedAt: MOVED, turnAt: iso(TURN), renderAt: iso(TURN + 60_000),
    });
  });

  it('reads the model through its long-context suffix', () => {
    expect(ask(session({ model: `${X1}[1m]` }))?.from).toBe(X1);
    expect(ask(session({ model: `${X2}[1m]` }))).toBeNull();
  });

  it('a session on the class id is not behind', () => {
    expect(ask(session({ model: X2 }))).toBeNull();
  });

  it('no class on the session, or no class row, is not behind', () => {
    expect(ask(session({ cls: null }))).toBeNull();
    expect(aliasSessionBehind(session(), null, adv(), L, NOW)).toBeNull();
  });

  it('a model of another family (a hand pick of another class) is not behind', () => {
    expect(ask(session({ model: S1 }))).toBeNull();
  });

  it('a model that is another class\'s current id or held row is not behind', () => {
    // An opus-family id another class names: a hand pick, so not behind.
    const l1 = lane({ opus: { id: X2, idSince: MOVED }, sonnet: { id: X1 } });
    expect(ask(session(), l1)).toBeNull();
    const l2 = lane({ opus: { id: X2, idSince: MOVED }, sonnet: { id: S1, heldRow: row(X1) } });
    expect(ask(session(), l2)).toBeNull();
  });

  it('an unlaunchable class id, or none, is no target', () => {
    expect(ask(session(), lane({ opus: { id: X2, idSince: MOVED, unlaunchable: { needs: '9.9.9', laneVersion: '1.0.0' } } }))).toBeNull();
    expect(ask(session(), lane({ opus: { id: null } }))).toBeNull();
  });

  it('doctor does not ask whether a launch has been seen on the id (the seen rule is the roll\'s)', () => {
    expect(ask(session(), lane({ opus: { id: X2, idSince: MOVED, seenId: X1 } }))?.to).toBe(X2);
    expect(ask(session(), lane({ opus: { id: X2, idSince: MOVED, seenId: null } }))?.to).toBe(X2);
  });

  it('while a hold stands the target is the held id, whatever the alias says', () => {
    const held = adv({ hold: { at: MOVED, by: 'operator', model: X0 } });
    expect(ask(session(), L, held)).toEqual({
      class: 'opus', from: X1, to: X0, movedAt: MOVED, turnAt: iso(TURN), renderAt: iso(TURN + 60_000),
    });
    expect(ask(session({ model: X0 }), L, held)).toBeNull();
    // Held on an unlaunchable alias id still names the held id.
    const ul = lane({ opus: { id: X2, idSince: MOVED, unlaunchable: { needs: '9.9.9', laneVersion: null } } });
    expect(ask(session(), ul, held)?.to).toBe(X0);
  });

  it('a hold that names no model is no target', () => {
    expect(ask(session(), L, adv({ hold: { at: MOVED, by: 'operator' } }))).toBeNull();
  });

  it('a render not after its turn marker is not a reading of that turn', () => {
    expect(ask(session({ renderMs: TURN }))).toBeNull();
    expect(ask(session({ renderMs: TURN - 1 }))).toBeNull();
  });

  it('with no turn marker, the render is the turn', () => {
    expect(ask(session({ turnAtMs: null, renderMs: TURN }))).toEqual({
      class: 'opus', from: X1, to: X2, movedAt: MOVED, turnAt: iso(TURN), renderAt: iso(TURN),
    });
  });

  it('the move must be at least a day old, and the turn after it', () => {
    const young = lane({ opus: { id: X2, idSince: iso(NOW - DAY + 1000) } });
    expect(ask(session({ turnAtMs: NOW - 1000, renderMs: NOW - 500 }), young)).toBeNull();
    expect(ask(session({ turnAtMs: NOW - 2 * DAY - 1000, renderMs: NOW - 2 * DAY }))).toBeNull();
    expect(ask(session({ turnAtMs: NOW - 2 * DAY, renderMs: NOW - 2 * DAY + 1 }))).toBeNull();
  });

  it('the move is the later of the id\'s arrival and the class\'s release; a hold\'s is its own time', () => {
    const released = iso(NOW - DAY - 2000);
    const r = ask(session({ turnAtMs: NOW - DAY - 1000, renderMs: NOW - DAY }), L, adv({ releasedAt: released }));
    expect(r?.movedAt).toBe(released);
    expect(ask(session({ turnAtMs: NOW - DAY - 3000, renderMs: NOW - DAY }), L, adv({ releasedAt: released }))).toBeNull();
  });

  it('an unreadable move time is never behind', () => {
    expect(ask(session(), lane({ opus: { id: X2, idSince: null } }))).toBeNull();
  });
});

// The inspector's routing line says what runs, and asks only what it can measure (desktop polish T3d, D-6334).
// A class is "asked" only where its readback word could appear in the lane's live model string; the provider
// reaches `routeView` from the roster through the one reader, `accountProvider`.
import { describe, expect, it } from 'vitest';
import type { FleetSession, RosterWire } from '../../shared/api';
import { accountProvider } from '../src/lib/accounts';
import { classReadbackMeasurable } from '../src/lib/models';
import { routeView } from '../src/session/routeView';
import { routingLine } from '../src/session/routingLine';
import { fleetSession } from './fleetFixture';

type Route = NonNullable<FleetSession['route']>;
const route = (over: Partial<Route> & { fields?: Route['fields'] } = {}): Route => ({
  fields: {}, degraded: null, inert: [], unreadable: [], ...over,
});

const line = (row: FleetSession, provider: Parameters<typeof routeView>[2], lane = 'Lane A') =>
  routingLine(row, routeView(row, row.wrapper, provider), lane);

const entry = (over: Partial<RosterWire> = {}): RosterWire => ({
  id: 'lane-a', label: 'Lane A', hue: 'cyan', homeAble: true, hidden: false, pool: null, ...over,
});

describe('the routing line says what runs and asks only what it can measure', () => {
  it("an Anthropic lane running what was asked reads 'Runs <model> on <lane> · effort <x>'", () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Opus 5.5 (1M context)', effort: 'high',
      route: route({ fields: { class: 'opus', effort: 'high' } }),
    });
    const out = line(row, 'anthropic');
    expect(out.sentence).toBe('Runs Opus 5.5 (1M context) on Lane A · effort high');
    expect(out.askedClass).toBeNull();
    expect(out.askedEffort).toBeNull();
    expect(out.unreadable).toBe(false);
  });

  it("an Anthropic lane with a pending class reads '· asked <class>'", () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'high',
      route: route({ fields: { class: 'opus' } }),
    });
    const out = line(row, 'anthropic');
    expect(out.askedClass).toBe('Opus 5.5');
    expect(out.sentence).toBe('Runs Sonnet 5 on Lane A · effort high · asked Opus 5.5');
  });

  it('a lane whose provider is absent never reads asked or queued for the class', () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'high',
      route: route({ fields: { class: 'opus' } }),
    });
    for (const provider of [null, accountProvider([entry()], 'lane-a')]) {
      const view = routeView(row, 'lane-a', provider);
      expect(view.classPending).toBe(false);
      expect(view.wireQueuedField).not.toBe('class');
      const out = routingLine(row, view, 'Lane A');
      expect(out.askedClass).toBeNull();
      expect(out.sentence).not.toMatch(/asked|queued/);
    }
  });

  it('a lane whose model ids carry no readback word never reads asked or queued', () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'deepseek-v4', effort: 'high',
      route: route({ fields: { class: 'opus' } }),
    });
    // An OpenRouter lane, and a second OpenAI lane that is not the dedicated one (it gets the Anthropic list).
    for (const provider of ['openrouter', 'openai'] as const) {
      const view = routeView(row, 'lane-a', provider);
      expect(view.classPending).toBe(false);
      expect(view.wireQueuedField).not.toBe('class');
      expect(routingLine(row, view, 'Lane A').sentence).not.toMatch(/asked|queued/);
    }
    // Control: the dedicated lane, on its own provider, can read its class back.
    const gpt = fleetSession({
      wrapper: 'gpt', model: 'GPT-5.6 Terra', effort: 'high',
      route: route({ fields: { class: 'opus' } }),
    });
    const view = routeView(gpt, 'gpt', 'openai');
    expect(view.classPending).toBe(true);
    expect(view.wireQueuedField).toBe('class');
    expect(routingLine(gpt, view, 'gpt').sentence).toContain('· asked GPT-5.6 Sol');
  });

  it("an inert effort reads 'effort set by the lane'", () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium',
      route: route({ fields: { effort: 'high' }, inert: ['effort'] }),
    });
    const out = line(row, 'anthropic');
    expect(out.effort).toBe('set by the lane');
    expect(out.askedEffort).toBeNull();
    expect(out.sentence).toBe('Runs Sonnet 5 on Lane A · effort set by the lane');
  });

  it("a pending effort reads '· asked effort <x>'", () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium',
      route: route({ fields: { effort: 'high' } }),
    });
    const out = line(row, 'anthropic');
    expect(out.askedEffort).toBe('high');
    expect(out.sentence).toBe('Runs Sonnet 5 on Lane A · effort medium · asked effort high');
  });

  it('a failed read says routing could not be read', () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium',
      route: route({ unreadable: ['class'] }),
    });
    const out = line(row, 'anthropic');
    expect(out.unreadable).toBe(true);
    expect(out.sentence).toBe('Runs Sonnet 5 on Lane A · effort medium · routing could not be read');
  });

  it('a row with no model or effort yet says so, and ultracode is its own word', () => {
    expect(line(fleetSession({ wrapper: 'lane-a' }), 'anthropic').sentence)
      .toBe('Runs a model not read yet on Lane A · effort not read yet');
    expect(line(fleetSession({ wrapper: 'lane-a', model: 'Opus 5', effort: 'xhigh', ultracode: true }), null).effort)
      .toBe('ultracode');
  });

  it('the line never says queued', () => {
    const rows: FleetSession[] = [
      fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: route({ fields: { class: 'opus', effort: 'high' } }) }),
      fleetSession({ wrapper: 'lane-a', model: 'deepseek-v4', route: route({ fields: { class: 'opus' }, unreadable: ['effort'] }) }),
      fleetSession({ wrapper: 'gpt', model: 'GPT-5.6 Luna', route: route({ fields: { class: 'opus' }, degraded: 'haiku' }) }),
      fleetSession({ wrapper: 'lane-a' }),
    ];
    for (const row of rows) {
      for (const provider of [null, 'anthropic', 'openrouter', 'openai'] as const) {
        expect(line(row, provider).sentence).not.toMatch(/queued/i);
      }
    }
  });
});

describe('classReadbackMeasurable', () => {
  it('is true only where the provider is known and is the provider of the list modelOptions picks', () => {
    expect(classReadbackMeasurable('lane-a', 'anthropic')).toBe(true);
    expect(classReadbackMeasurable('lane-a', 'openai')).toBe(false);
    expect(classReadbackMeasurable('lane-a', 'openrouter')).toBe(false);
    expect(classReadbackMeasurable('lane-a', null)).toBe(false);
    expect(classReadbackMeasurable('gpt', 'openai')).toBe(true);
    expect(classReadbackMeasurable('gpt', 'anthropic')).toBe(false);
    expect(classReadbackMeasurable('gpt', null)).toBe(false);
  });
});

describe('accountProvider', () => {
  it('answers the roster entry\'s provider when it is one this build knows', () => {
    expect(accountProvider([entry({ provider: 'openrouter' })], 'lane-a')).toBe('openrouter');
    expect(accountProvider([entry({ provider: 'anthropic' })], 'lane-a')).toBe('anthropic');
  });
  it('answers null for an entry that carries no provider', () => {
    expect(accountProvider([entry()], 'lane-a')).toBeNull();
  });
  it('answers null for a provider this build does not know', () => {
    const newer = entry({ provider: 'a-newer-provider' as unknown as RosterWire['provider'] });
    expect(accountProvider([newer], 'lane-a')).toBeNull();
  });
  it('answers null for a wrapper the roster does not have', () => {
    expect(accountProvider([entry({ provider: 'anthropic' })], 'lane-z')).toBeNull();
  });
  it('answers null for an empty roster', () => {
    expect(accountProvider([], 'lane-a')).toBeNull();
  });
});

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

  it('both a pending effort and a pending class read in the line\'s order', () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low',
      route: route({ fields: { class: 'opus', effort: 'high' } }),
    });
    const view = routeView(row, 'lane-a', 'anthropic');
    // Today's precedence: the effort is the field the wire reports as queued.
    expect(view.wireQueuedField).toBe('effort');
    expect(view.classPending).toBe(true);
    expect(view.effortPending).toBe(true);
    expect(routingLine(row, view, 'Lane A').sentence)
      .toBe('Runs Sonnet 5 on Lane A · effort low · asked Opus 5.5 · asked effort high');
  });

  it('with no routing record nothing is pending', () => {
    const row = fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: null });
    const view = routeView(row, 'lane-a', 'anthropic');
    expect(view.classPending).toBe(false);
    expect(view.effortPending).toBe(false);
    expect(view.wireQueuedField).toBeNull();
    expect(routingLine(row, view, 'Lane A').sentence).toBe('Runs Sonnet 5 on Lane A · effort low');
  });

  it('an unreadable effort says routing could not be read and asks nothing of the effort', () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium',
      route: route({ unreadable: ['effort'] }),
    });
    const view = routeView(row, 'lane-a', 'anthropic');
    expect(view.effortUnreadable).toBe(true);
    expect(view.effortPending).toBe(false);
    expect(routingLine(row, view, 'Lane A').sentence)
      .toBe('Runs Sonnet 5 on Lane A · effort medium · routing could not be read');
  });

  it('the parts join to the sentence', () => {
    const rows: [FleetSession, Parameters<typeof routeView>[2]][] = [
      [fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: route({ fields: { class: 'opus', effort: 'high' } }) }), 'anthropic'],
      [fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: route({ unreadable: ['class'] }) }), 'anthropic'],
      [fleetSession({ wrapper: 'lane-a', route: route({ fields: { effort: 'high' }, inert: ['effort'] }) }), null],
      [fleetSession({ wrapper: 'lane-a', model: 'Opus 5', effort: 'xhigh', ultracode: true }), 'anthropic'],
    ];
    for (const [row, provider] of rows) {
      const out = line(row, provider);
      expect(out.parts.map((p) => p.text).join('')).toBe(out.sentence);
      // The two doors are the live model and the live effort, once each, in that order.
      expect(out.parts.filter((p) => p.kind === 'model' || p.kind === 'effort').map((p) => p.kind))
        .toEqual(['model', 'effort']);
    }
    expect(line(rows[0]![0], 'anthropic').parts.filter((p) => p.kind === 'asked').map((p) => p.text))
      .toEqual(['asked Opus 5.5', 'asked effort high']);
  });

  it("every '·' is a sep part, and each sep leads, past plain words only, to a door, an ask or a note", () => {
    const rows: [FleetSession, Parameters<typeof routeView>[2]][] = [
      [fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: route({ fields: { class: 'opus', effort: 'high' } }) }), 'anthropic'],
      [fleetSession({ wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low', route: route({ unreadable: ['class'] }) }), 'anthropic'],
      [fleetSession({ wrapper: 'lane-a', route: route({ fields: { class: 'opus' }, inert: ['class', 'effort'] }) }), 'anthropic'],
      [fleetSession({ wrapper: 'lane-a' }), 'anthropic'],
    ];
    for (const [row, provider] of rows) {
      const out = line(row, provider);
      expect(out.parts.filter((p) => p.kind !== 'sep' && p.text.includes('·')), out.sentence).toEqual([]);
      out.parts.forEach((p, i) => {
        if (p.kind !== 'sep') return;
        const next = out.parts.slice(i + 1).find((q) => q.kind !== 'text');
        expect(next && next.kind !== 'sep', `${out.sentence} @${i}`).toBe(true);
      });
      // The effort door is always reached through a separator.
      const effortAt = out.parts.findIndex((p) => p.kind === 'effort');
      expect(out.parts.slice(0, effortAt).some((p) => p.kind === 'sep'), out.sentence).toBe(true);
    }
  });

  it('the separator is its own sep part, so an asked part and the note hold only their words', () => {
    const both = line(fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'low',
      route: route({ fields: { class: 'opus', effort: 'high' }, unreadable: [] }),
    }), 'anthropic');
    const kinds = both.parts.map((p) => `${p.kind}:${p.text}`);
    expect(kinds.slice(-5)).toEqual([
      'effort:low', 'sep: · ', 'asked:asked Opus 5.5', 'sep: · ', 'asked:asked effort high',
    ]);
    const note = line(fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium', route: route({ unreadable: ['effort'] }),
    }), 'anthropic');
    expect(note.parts.slice(-2).map((p) => `${p.kind}:${p.text}`))
      .toEqual(['sep: · ', 'note:routing could not be read']);
  });

  it("an inert effort on an ultracode pane is a plain door", () => {
    const inert = line(fleetSession({
      wrapper: 'lane-a', model: 'Opus 5', effort: 'xhigh', ultracode: true,
      route: route({ fields: { effort: 'max' }, inert: ['effort'] }),
    }), 'anthropic');
    expect(inert.parts.find((p) => p.kind === 'effort')).toMatchObject({ text: 'set by the lane', tone: 'plain' });
    const live = line(fleetSession({ wrapper: 'lane-a', model: 'Opus 5', effort: 'xhigh', ultracode: true }), 'anthropic');
    expect(live.parts.find((p) => p.kind === 'effort')).toMatchObject({ text: 'ultracode', tone: 'ultra' });
    const plain = line(fleetSession({ wrapper: 'lane-a', model: 'Opus 5', effort: 'high' }), 'anthropic');
    expect(plain.parts.find((p) => p.kind === 'effort')).toMatchObject({ tone: 'plain' });
    expect(plain.parts.find((p) => p.kind === 'model')).toMatchObject({ tone: 'model' });
  });

  it("an inert class reads 'model set by the lane' and asks nothing of the class", () => {
    const row = fleetSession({
      wrapper: 'lane-a', model: 'Sonnet 5', effort: 'medium',
      route: route({ fields: { class: 'opus' }, inert: ['class'] }),
    });
    const view = routeView(row, 'lane-a', 'anthropic');
    expect(view.classInert).toBe(true);
    expect(view.classPending).toBe(false);
    const out = routingLine(row, view, 'Lane A');
    expect(out.askedClass).toBeNull();
    expect(out.sentence).toBe('Runs Sonnet 5 on Lane A · effort medium · model set by the lane');
    expect(out.parts.slice(-2).map((p) => `${p.kind}:${p.text}`)).toEqual(['sep: · ', 'note:model set by the lane']);
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

import { describe, it, expect } from 'vitest';
import { ROUTE_WRITABLE_FIELDS } from '../../shared/api';
import type { LaneModelsRead } from '../../shared/models';
import { EFFORT_LADDER } from '../../shared/routing-ladder';
import {
  asLaneModelsRead, classWord, effortOptions, laneClassLabel, liveModelNames, modelOptions, modelReadbackFor,
  type PickOption,
} from '../src/lib/models';

/**
 * The session pickers' one pin. D-8406: a model row names the model its class maps to on the session's lane, from that
 * lane's own files — the registry's model id and the catalogue's label, as `GET /api/models/:lane` reads them — and
 * never from a name this tree spells. The fixtures below are those files' readings, so a model advance is a fixture
 * edit here and no code change in `lib/models.ts`.
 *
 * Routing spec 2026-09-14 §5.3, slice 4, Task 5: a row no longer carries a slash `command` — it carries the routing
 * record write a tap performs (`route: {field, value}`), the bare class alias, whatever the row's label says.
 *
 * D-2015: the dedicated lane offers its fable class too: without the row the class is reachable only by typing
 * `/model fable`, which is exactly the knowledge a phone-first console exists to remove.
 */
const read = (classes: Record<'fable' | 'opus' | 'sonnet' | 'haiku', [string | null, string | null]>): LaneModelsRead => ({
  kind: 'read',
  classes: {
    fable: { model: classes.fable[0], label: classes.fable[1] }, opus: { model: classes.opus[0], label: classes.opus[1] },
    sonnet: { model: classes.sonnet[0], label: classes.sonnet[1] }, haiku: { model: classes.haiku[0], label: classes.haiku[1] },
  },
});

/** The dedicated lane's files today: the operator's report of 2026-11-13. */
const GPT_LANE = read({
  fable: ['gpt-6-astra', 'GPT-6-Astra'], opus: ['gpt-6.1-sol', 'GPT-6.1-Sol'],
  sonnet: ['gpt-6.1-terra', 'GPT-6.1 Terra'], haiku: ['gpt-6-luna', 'GPT-6 Luna'],
});
/** A lane on the Anthropic list whose registry maps the classes onto Claude model ids (an OpenRouter-style lane). */
const CLAUDE_LANE = read({
  fable: ['anthropic/claude-fable-5', 'Claude Fable 5'], opus: ['anthropic/claude-opus-5.5', 'Claude Opus 5.5'],
  sonnet: ['anthropic/claude-sonnet-5', 'Claude Sonnet 5'], haiku: ['anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'],
});

describe('modelOptions (D-8406: labels from the lane registry)', () => {
  const routes = (w: string, lane: LaneModelsRead | null, cur: string | null = null) =>
    modelOptions(w, lane, cur).map((o: PickOption) => `${o.route.field}=${o.route.value}`);
  const labels = (w: string, lane: LaneModelsRead | null) => modelOptions(w, lane, null).map((o) => o.label);

  it('the gpt lane: four rows, most capable first, each the catalogue label of its registry model', () => {
    expect(routes('gpt', GPT_LANE)).toEqual(['class=fable', 'class=opus', 'class=sonnet', 'class=haiku']);
    expect(labels('gpt', GPT_LANE)).toEqual(['GPT-6-Astra', 'GPT-6.1-Sol', 'GPT-6.1 Terra', 'GPT-6 Luna']);
    expect(modelOptions('gpt', GPT_LANE, null).map((o) => o.sublabel))
      .toEqual(['Fable class', 'Opus class', 'Sonnet class', 'Haiku class']);
    expect(modelOptions('gpt', GPT_LANE, null).map((o) => o.readback))
      .toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
  });

  it('a model advance in the registry changes the label and the readback, and nothing else', () => {
    const advanced = read({
      fable: ['gpt-6-astra', 'GPT-6-Astra'], opus: ['gpt-6.2-sol', 'GPT-6.2-Sol'],
      sonnet: ['gpt-6.1-terra', 'GPT-6.1 Terra'], haiku: ['gpt-6-luna', 'GPT-6 Luna'],
    });
    const before = modelOptions('gpt', GPT_LANE, null);
    const after = modelOptions('gpt', advanced, null);
    expect(after[1]).toMatchObject({ label: 'GPT-6.2-Sol', readback: 'gpt-6.2-sol', route: { field: 'class', value: 'opus' } });
    expect(after.map((o) => o.route)).toEqual(before.map((o) => o.route));
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
  });

  it('a lane on the Anthropic list: its own order, its labels, and Default last', () => {
    expect(routes('lane-a', CLAUDE_LANE))
      .toEqual(['class=opus', 'class=sonnet', 'class=fable', 'class=haiku', 'class=default']);
    expect(labels('lane-a', CLAUDE_LANE))
      .toEqual(['Claude Opus 5.5', 'Claude Sonnet 5', 'Claude Fable 5', 'Claude Haiku 4.5', 'Default']);
    const def = modelOptions('lane-a', CLAUDE_LANE, null).at(-1)!;
    expect(def.readback).toBe('');
    expect(def.sublabel).toBeUndefined();
  });

  it('never offers a bare "Default" on the gpt lane', () => {
    // Routing to `class=default` resolves through ANTHROPIC_MODEL, which the lane's env owns; offering it would
    // present a row whose meaning the console cannot state.
    for (const lane of [GPT_LANE, null]) expect(routes('gpt', lane)).not.toContain('class=default');
  });

  it('with no registry read — not yet, none, or unreadable — every row is its class name, never a model name', () => {
    for (const lane of [null, { kind: 'absent' }, { kind: 'unreadable' }] as const) {
      expect(labels('gpt', lane)).toEqual(['Fable class', 'Opus class', 'Sonnet class', 'Haiku class']);
      expect(labels('claude', lane)).toEqual(['Opus class', 'Sonnet class', 'Fable class', 'Haiku class', 'Default']);
      expect(modelOptions('gpt', lane, null).map((o) => o.sublabel)).toEqual([undefined, undefined, undefined, undefined]);
      // The dedicated lane's pane prints a model id no class word is part of: nothing to read back.
      expect(modelOptions('gpt', lane, null).map((o) => o.readback)).toEqual(['', '', '', '']);
      // The Anthropic list keeps the bare FAMILY word, which the pane's family name carries whatever its version.
      expect(modelOptions('claude', lane, null).map((o) => o.readback)).toEqual(['opus', 'sonnet', 'fable', 'haiku', '']);
    }
  });

  it('a registry with no catalogue label for a class names that row by its class, and keeps the model as its readback', () => {
    const thin = read({
      fable: ['gpt-6-astra', null], opus: ['gpt-6.1-sol', 'GPT-6.1-Sol'],
      sonnet: ['gpt-6.1-terra', null], haiku: ['gpt-6-luna', null],
    });
    expect(labels('gpt', thin)).toEqual(['Fable class', 'GPT-6.1-Sol', 'Sonnet class', 'Haiku class']);
    expect(modelOptions('gpt', thin, null)[0]!.readback).toBe('gpt-6-astra');
    expect(modelOptions('gpt', thin, null)[0]!.sublabel).toBeUndefined();
  });

  it('a class the registry says is unavailable on this lane has no row', () => {
    const three = read({
      fable: [null, null], opus: ['gpt-6.1-sol', 'GPT-6.1-Sol'],
      sonnet: ['gpt-6.1-terra', 'GPT-6.1 Terra'], haiku: ['gpt-6-luna', 'GPT-6 Luna'],
    });
    expect(routes('gpt', three)).toEqual(['class=opus', 'class=sonnet', 'class=haiku']);
  });

  it('every row writes a field ROUTE_WRITABLE_FIELDS knows, and never carries a command key', () => {
    for (const [wrapper, lane] of [['gpt', GPT_LANE], ['gpt', null], ['claude', null], ['lane-a', CLAUDE_LANE]] as const) {
      for (const o of modelOptions(wrapper, lane, null)) {
        expect(ROUTE_WRITABLE_FIELDS as readonly string[], o.label).toContain(o.route.field);
        expect('command' in o, o.label).toBe(false);
      }
    }
  });

  it('the active row follows the session\'s live model, and only that one', () => {
    const active = (w: string, lane: LaneModelsRead | null, cur: string) =>
      modelOptions(w, lane, cur).filter((o) => o.active).map((o) => o.label);
    expect(active('gpt', GPT_LANE, 'gpt-6-astra')).toEqual(['GPT-6-Astra']);
    expect(active('gpt', GPT_LANE, 'gpt-6.1-sol')).toEqual(['GPT-6.1-Sol']);
    expect(active('gpt', GPT_LANE, 'gpt-6.1-terra')).toEqual(['GPT-6.1 Terra']);
    expect(active('gpt', GPT_LANE, 'gpt-6-luna')).toEqual(['GPT-6 Luna']);
    // A context suffix, and a pane that title-cases or spaces the id, do not defeat the match.
    expect(active('gpt', GPT_LANE, 'gpt-6.1-sol[1m]')).toEqual(['GPT-6.1-Sol']);
    expect(active('gpt', GPT_LANE, 'GPT-6.1 Sol')).toEqual(['GPT-6.1-Sol']);
    // A model the registry no longer maps lights nothing: the old model is not this lane's opus any more.
    expect(active('gpt', GPT_LANE, 'gpt-5.6-sol')).toEqual([]);
    // With no registry, the dedicated lane cannot say which row the pane is on.
    expect(active('gpt', null, 'gpt-6.1-sol')).toEqual([]);
    // The Anthropic list with no registry: the family word in the pane's name, whatever its version.
    expect(active('claude', null, 'Opus 5.5 (1M context)')).toEqual(['Opus class']);
    expect(active('claude', { kind: 'absent' }, 'Sonnet 5')).toEqual(['Sonnet class']);
    expect(active('lane-a', CLAUDE_LANE, 'anthropic/claude-haiku-4.5')).toEqual(['Claude Haiku 4.5']);
  });

  it('when one row\'s model id extends another\'s, the pane lights the longer one alone', () => {
    const nested = read({
      fable: ['gpt-6-astra', 'Astra'], opus: ['gpt-6', 'Six'], sonnet: ['gpt-6.1-terra', 'Terra'], haiku: ['gpt-6-luna', 'Luna'],
    });
    expect(modelOptions('gpt', nested, 'gpt-6-astra').filter((o) => o.active).map((o) => o.label)).toEqual(['Astra']);
    expect(modelOptions('gpt', nested, 'gpt-6').filter((o) => o.active).map((o) => o.label)).toEqual(['Six']);
  });

  it('the readback the queued check uses is the registry model, and none where the lane cannot name one', () => {
    expect(modelReadbackFor('gpt', GPT_LANE, 'opus')).toBe('gpt-6.1-sol');
    expect(modelReadbackFor('gpt', null, 'opus')).toBeNull();
    expect(modelReadbackFor('claude', null, 'opus')).toBe('opus');
    expect(modelReadbackFor('claude', null, 'default')).toBeNull();
    expect(modelReadbackFor('gpt', GPT_LANE, 'ludicrous')).toBeNull();
  });

  // Whole-branch review M1: `route.degraded` — the class ccd IS serving when
  // no lane could serve the intended one (spec §5.4). `degradedTo` carries a
  // LABEL off THIS lane's own list, never the bare alias.
  describe('the degraded-class note (whole-branch review M1)', () => {
    const noted = (w: string, lane: LaneModelsRead | null, intended: string, degraded: string | null): (string | undefined)[] =>
      modelOptions(w, lane, null, { intended, inert: false, degraded })
        .filter((o) => o.active).map((o) => o.degradedTo);

    it('names the served class by its label on this lane, on the intended row alone', () => {
      expect(noted('claude', null, 'opus', 'haiku')).toEqual(['Haiku class']);
      expect(noted('gpt', GPT_LANE, 'opus', 'haiku')).toEqual(['GPT-6 Luna']);
    });

    it('sets nothing when the stamp names the intended class itself, or is absent', () => {
      expect(noted('claude', null, 'opus', 'opus')).toEqual([undefined]);
      expect(noted('claude', null, 'opus', null)).toEqual([undefined]);
      // Omitted entirely — the S6-R4 "nothing changes" shape — is the same
      // answer as an explicit null, never a crash or a stray note.
      expect(modelOptions('claude', null, null, { intended: 'opus', inert: false })
        .filter((o) => o.active).map((o) => o.degradedTo)).toEqual([undefined]);
    });

    it('falls back to the raw stamped word for a class no row here carries — a degradation it cannot name is still one', () => {
      expect(noted('claude', null, 'opus', 'ludicrous')).toEqual(['ludicrous']);
    });

    it('attaches to no row at all when the class read was unreadable — no active row to sit beside', () => {
      expect(modelOptions('claude', null, 'Haiku 4.5', { intended: null, inert: false, unreadable: true, degraded: 'haiku' })
        .filter((o) => o.degradedTo !== undefined)).toEqual([]);
    });
  });
});

describe('the lane-models helpers (D-8406)', () => {
  it('classWord and laneClassLabel', () => {
    expect(classWord('opus')).toBe('Opus class');
    expect(laneClassLabel(GPT_LANE, 'sonnet')).toBe('GPT-6.1 Terra');
    expect(laneClassLabel({ kind: 'unreadable' }, 'sonnet')).toBeNull();
    expect(laneClassLabel(null, 'sonnet')).toBeNull();
  });

  it('liveModelNames folds case and punctuation, and an empty key names nothing', () => {
    expect(liveModelNames('GPT-6.1 Sol (1M context)', 'gpt-6.1-sol')).toBe(true);
    expect(liveModelNames('gpt-6.1-terra', 'gpt-6.1-sol')).toBe(false);
    expect(liveModelNames('anything', '')).toBe(false);
    expect(liveModelNames(null, 'opus')).toBe(false);
  });

  it('asLaneModelsRead takes the route\'s answer and refuses anything that is not one', () => {
    expect(asLaneModelsRead({ ok: true, lane: 'gpt', models: GPT_LANE })).toEqual(GPT_LANE);
    expect(asLaneModelsRead({ ok: true, lane: 'gpt', models: { kind: 'absent' } })).toEqual({ kind: 'absent' });
    expect(asLaneModelsRead({ ok: true, lane: 'gpt', models: { kind: 'unreadable' } })).toEqual({ kind: 'unreadable' });
    expect(asLaneModelsRead({ ok: false, error: 'not-found' })).toBeNull();
    expect(asLaneModelsRead(null)).toBeNull();
    expect(asLaneModelsRead({ models: { kind: 'later' } })).toBeNull();
    // A class missing, or a model or label that is neither a string nor null, trusts no class.
    const { haiku: _h, ...three } = (GPT_LANE as Extract<LaneModelsRead, { kind: 'read' }>).classes;
    expect(asLaneModelsRead({ models: { kind: 'read', classes: three } })).toBeNull();
    expect(asLaneModelsRead({ models: { kind: 'read', classes: { ...three, haiku: { model: 7, label: null } } } })).toBeNull();
  });
});

describe('effortOptions', () => {
  it('withholds ultracode from the gpt lane and offers it everywhere else', () => {
    expect(effortOptions('gpt', 'high', false).map((o) => o.label)).not.toContain('Ultracode');
    expect(effortOptions('claude', 'high', false).map((o) => o.label)).toContain('Ultracode');
  });

  it('every row writes the effort field, ultracode included, and Auto writes effort=auto', () => {
    for (const wrapper of ['gpt', 'claude']) {
      for (const o of effortOptions(wrapper, null, false)) {
        expect(o.route.field, o.label).toBe('effort');
        expect('command' in o, o.label).toBe(false);
      }
    }
    expect(effortOptions('claude', null, false).find((o) => o.label === 'Auto')?.route)
      .toEqual({ field: 'effort', value: 'auto' });
    expect(effortOptions('claude', null, false).find((o) => o.label === 'Ultracode')?.route)
      .toEqual({ field: 'effort', value: 'ultracode' });
  });

  // The picker's five slider stops come from EFFORT_LADDER (shared/routing-ladder.ts)
  // rather than five hand-built rows — Auto and Ultracode are the picker's own
  // labelled superset on top of the ladder, never part of it.
  const levelRows = (opts: PickOption[]) =>
    opts.filter((o) => o.label !== 'Auto' && o.label !== 'Ultracode');

  it('the five level rows equal EFFORT_LADDER in order, capitalised', () => {
    const rows = levelRows(effortOptions('claude', null, false));
    expect(rows.map((o) => o.route.value)).toEqual([...EFFORT_LADDER]);
    expect(rows.map((o) => o.label)).toEqual(
      EFFORT_LADDER.map((v) => v[0]!.toUpperCase() + v.slice(1)),
    );
  });

  it('control: the five stops match the spec\'s own hand-written list — not a value derived from EFFORT_LADDER itself, so a reordered or shortened ladder reds this', () => {
    const rows = levelRows(effortOptions('claude', null, false));
    expect(rows.map((o) => o.route.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('pins the full row order — Auto last, Ultracode spliced before Max on a non-gpt wrapper only — against a hand-written literal, not the ladder itself', () => {
    expect(effortOptions('claude', null, false).map((o) => o.label)).toEqual([
      'Low', 'Medium', 'High', 'Xhigh', 'Ultracode', 'Max', 'Auto',
    ]);
    expect(effortOptions('gpt', null, false).map((o) => o.label)).toEqual([
      'Low', 'Medium', 'High', 'Xhigh', 'Max', 'Auto',
    ]);
  });
});

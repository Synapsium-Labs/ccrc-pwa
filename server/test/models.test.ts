// `shared/models.ts` — the registry file's type and validator (§4.1), the
// catalogue's (§4.2) and the derived states (§4.3).
//
// Fix round 1 (2026-09-08 review): the first draft had `shared/models.ts` and
// `shared/models.mjs` each carrying a full, independently-implemented copy of
// every function, and this file drove both and compared them as twins. The
// review measured ~200 duplicated lines — the first duplicated pair in
// `shared/`, where every other bare-`node` module (`shared/generate.mjs`,
// `shared/wrapper.mjs`, `shared/mark.mjs`, `shared/roster-json.mjs`) is ONE
// implementation plus a hand-written `.d.mts`. The controller ruled
// single-source: `shared/models.mjs` is now the one implementation — the
// callers that run under a bare `node` (`deploy/models-op.mjs`,
// `shared/modelenv.mjs`, and Plan 2's ccd reader) import it directly, and
// `shared/models.ts`, which the server and the PWA bundle, re-exports every
// function, `MODEL_ID_RE`, `RegistryInvalid`, `CatalogueInvalid` and
// `UNAVAILABLE_PREFIX` straight from it. This file therefore imports
// everything from `'../../shared/models.js'` ONCE and drives `modelCases`
// over it ONCE — there is no second implementation left to disagree with the
// first. What remains genuinely duplicated — `CLASSES` and `PROBE_KINDS`,
// kept on the `.ts` side only for their `as const`-derived TYPES, with a
// private unexported copy in `.mjs` because `.mjs` cannot import `.ts` back
// — is still pinned element-for-element below, `shared/wrapper.mjs` /
// `shared/generate.mjs`'s arrangement in this tree and its reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSES, CatalogueInvalid, PROBE_KINDS, RegistryInvalid, UNAVAILABLE_PREFIX,
  availableFor, classOfModel, deriveModels, familyClassOf, parseCatalogue,
  parseRegistry, resolveDiscovery,
} from '../../shared/models.js';
import { CODEX, SEEDED, UNSEEDED, modelCases } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const clone = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('the case table this drives is real', () => {
  it('covers every derived state in both directions', () => {
    // A table where nothing is ever retired, or every lane is available, lets
    // half the derivation be deleted silently. `single-definition.test.ts`'s
    // "the name list this scans is real" reasoning.
    expect(modelCases.length).toBeGreaterThanOrEqual(10);
    expect(modelCases.some((c) => c.expect.retired.length > 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.retired.length === 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.available.length === 3)).toBe(true);
    expect(modelCases.some((c) => c.expect.available.length === 0)).toBe(true);
    expect(modelCases.some((c) => c.expect.unclassified.length > 0)).toBe(true);
    expect(modelCases.some((c) => c.catalogue?.stale === true)).toBe(true);
    expect(modelCases.some((c) => c.catalogue === null)).toBe(true);
    expect(modelCases.some((c) => c.reg === null)).toBe(true);
  });
});

describe('deriveModels', () => {
  it.each(modelCases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    expect(deriveModels(c.reg, c.catalogue)).toEqual(c.expect);
  });

  it('a retired class NEVER empties its slot — retirement is a separate fact', () => {
    // Ruling 4 of the skeleton, and §4.3: `retired` is positive, `available` is
    // what routing consumes, and the operator's own assignment survives a
    // provider withdrawing a model.
    const c = modelCases.find((x) => x.expect.retired.length === 4)!;
    expect(deriveModels(c.reg, c.catalogue).available).toEqual([]);
    expect(c.reg!.classes.opus).toBe('gone-c');
  });

  it('an id retired ONLY through discovery, never classified, still retires', () => {
    // Fix round 1, Finding 2: `[...classified, ...discovery]` in the
    // retirement loop has two halves, and every OTHER case above leaves the
    // `...discovery` half unmeasured — dropping it silently survived the
    // whole suite. `gpt-gone` here is reachable only through `discovery`, so
    // this is the one row that reds if that half is ever dropped again.
    const c = modelCases.find((x) => x.why.includes('retired ONLY through discovery'))!;
    expect(c.reg!.classes.haiku).toBe('gpt-5.6-luna');
    expect(deriveModels(c.reg, c.catalogue)).toEqual(c.expect);
  });
});

describe('availableFor — the ONE place "anthropic lanes have all four" lives', () => {
  it('is all four on an anthropic lane, whatever the registry says', () => {
    // §4.1, decision 4: their classes are Claude Code's own defaults and there
    // is no registry file. The boolean comes from the CALLER because the roster
    // on main has no provider field to derive it from (deviation B-3).
    expect(availableFor(null, null, true)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    expect(availableFor(SEEDED, CODEX, true)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  it('is deriveModels\' answer on every other lane', () => {
    expect(availableFor(SEEDED, CODEX, false)).toEqual(['haiku', 'sonnet', 'opus']);
    expect(availableFor(null, CODEX, false)).toEqual([]);
    expect(availableFor(UNSEEDED, null, false)).toEqual([]);
  });
});

describe('resolveDiscovery', () => {
  it('"catalogue" is the VISIBLE ids, in catalogue order', () => {
    expect(resolveDiscovery(SEEDED, CODEX)).toEqual([
      'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
    ]);
  });

  it('"catalogue" with no catalogue is EMPTY, not "everything"', () => {
    // Absent file = never probed, a distinct state from an empty catalogue
    // (§4.2). Resolving it to the classed ids would make `unclassified`
    // silently empty and hide the whole reason this design exists.
    expect(resolveDiscovery(SEEDED, null)).toEqual([]);
  });

  it('an explicit list is returned as written', () => {
    const reg = { ...UNSEEDED, discovery: ['b', 'a'] };
    expect(resolveDiscovery(reg, CODEX)).toEqual(['b', 'a']);
  });
});

describe('parseRegistry (§4.1)', () => {
  const good = (): Record<string, unknown> => clone(SEEDED) as Record<string, unknown>;

  it('round-trips the seeded gpt registry', () => {
    expect(parseRegistry(good())).toEqual(SEEDED);
  });

  it('round-trips an UNSEEDED registry — every class null is legal (deviation B-1)', () => {
    expect(parseRegistry(clone(UNSEEDED))).toEqual(UNSEEDED);
  });

  it.each(['haiku', 'sonnet', 'opus', 'fable'] as const)(
    'refuses a registry missing the %s slot, naming it', (cls) => {
      const r = good();
      const classes = { ...(r['classes'] as Record<string, unknown>) };
      delete classes[cls];
      r['classes'] = classes;
      expect(() => parseRegistry(r)).toThrow(new RegExp(`classes\\.${cls}`));
    });

  it.each([
    ['a leading slash', '/vendor/opus'],
    ['a space', 'vendor/opus 1'],
    ['a quote', 'vendor/"opus"'],
    ['the empty string', ''],
  ] as const)('refuses %s as a class id', (_why, bad) => {
    const r = good();
    (r['classes'] as Record<string, unknown>)['opus'] = bad;
    expect(() => parseRegistry(r)).toThrow(/classes\.opus/);
  });

  it('accepts the punctuation OpenRouter ids are made of', () => {
    const r = good();
    (r['classes'] as Record<string, unknown>)['opus'] = 'anthropic/claude-opus-4.5:beta';
    expect(parseRegistry(r).classes.opus).toBe('anthropic/claude-opus-4.5:beta');
  });

  it('refuses an unknown probe kind, naming the three', () => {
    const r = good(); r['probe'] = 'gemini';
    expect(() => parseRegistry(r)).toThrow(/codex, openrouter, compatible/);
  });

  it('requires baseUrl when the probe is compatible, and refuses it as empty', () => {
    // Round-2 ruling 10: `compatible` reads its endpoint from the registry file
    // until `exec.baseUrl` exists on main — nothing else on this box knows one.
    const r = good(); r['probe'] = 'compatible';
    expect(() => parseRegistry(r)).toThrow(/baseUrl/);
    r['baseUrl'] = '';
    expect(() => parseRegistry(r)).toThrow(/baseUrl/);
    r['baseUrl'] = 'https://api.cortecs.ai';
    expect(parseRegistry(r).baseUrl).toBe('https://api.cortecs.ai');
  });

  it('accepts baseUrl on a codex or openrouter registry but never requires it', () => {
    expect(parseRegistry(good()).baseUrl).toBeUndefined();
  });

  it('refuses a subagent that is not a class', () => {
    const r = good(); r['subagent'] = 'sonnet-class';
    expect(() => parseRegistry(r)).toThrow(/subagent/);
  });

  it('refuses a subagent naming a NULL slot on a seeded registry (§4.1)', () => {
    // The env block resolves CLAUDE_CODE_SUBAGENT_MODEL to classes[subagent]
    // (§6.1). A subagent pointing at a null slot is a lane whose subagents run
    // on a sentinel.
    const r = good(); r['subagent'] = 'fable';
    expect(() => parseRegistry(r)).toThrow(/subagent/);
  });

  it('ALLOWS a subagent naming a null slot when EVERY slot is null (deviation B-1)', () => {
    expect(() => parseRegistry(clone(UNSEEDED))).not.toThrow();
  });

  it('there is no `selectable` field, and an unknown key is refused by name', () => {
    // `selectable` is the account-connections branch's picker PERMISSION and
    // is deliberately NOT this design's `discovery` (§2, ruling 280). A file
    // carrying it is a file somebody confused the two in.
    const r = good(); r['selectable'] = ['gpt-5.5'];
    expect(() => parseRegistry(r)).toThrow(/selectable/);
  });

  it('refuses an empty discovery list on a SEEDED registry', () => {
    const r = good(); r['discovery'] = [];
    expect(() => parseRegistry(r)).toThrow(/discovery/);
  });

  it('refuses a duplicate in the discovery list', () => {
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-sol'];
    expect(() => parseRegistry(r)).toThrow(/gpt-5\.6-sol/);
  });

  it('refuses a non-null class id the explicit discovery list does not offer', () => {
    // A routing target nothing discovered is a lane that answers `/model opus`
    // with a model no surface ever showed (§4.1).
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra'];
    expect(() => parseRegistry(r)).toThrow(/gpt-5\.6-sol/);
  });

  it('does not require a NULL slot to be discovered', () => {
    const r = good(); r['discovery'] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
    expect(() => parseRegistry(r)).not.toThrow();
  });

  it('refuses discovery "catalogue" on openrouter, naming the field', () => {
    // Several hundred models is not a discovery scope (§2).
    const r = good(); r['probe'] = 'openrouter'; r['discovery'] = 'catalogue';
    expect(() => parseRegistry(r)).toThrow(/openrouter requires an explicit discovery list/);
  });

  it('accepts discovery "catalogue" on codex and on compatible', () => {
    expect(parseRegistry(good()).discovery).toBe('catalogue');
    const r = good(); r['probe'] = 'compatible'; r['baseUrl'] = 'https://x.example';
    expect(parseRegistry(r).discovery).toBe('catalogue');
  });

  it('refuses an effort key that is not a class', () => {
    const r = good(); r['effort'] = { subagent: 'high' };
    expect(() => parseRegistry(r)).toThrow(/effort\.subagent/);
  });

  it('refuses an empty effort level', () => {
    const r = good(); r['effort'] = { opus: '' };
    expect(() => parseRegistry(r)).toThrow(/effort\.opus/);
  });

  it('validates an effort level AGAINST the catalogue when one is handed in', () => {
    // Luna has no `ultra`; Astra does (§4.1). A lane default the provider
    // rejects turns every turn on that class into a 400.
    const r = good(); (r['effort'] as Record<string, string>)['haiku'] = 'ultra';
    expect(() => parseRegistry(r, CODEX)).toThrow(/effort\.haiku/);
    expect(() => parseRegistry(r, null)).not.toThrow();
  });

  it('accepts an unvalidatable level when the catalogue lists the model with NO efforts', () => {
    // An empty `efforts` is "unknown", never "none offered" — every OpenRouter
    // and `compatible` row is like that.
    const bare = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, efforts: [] })) };
    const r = good(); (r['effort'] as Record<string, string>)['haiku'] = 'ultra';
    expect(() => parseRegistry(r, bare)).not.toThrow();
  });

  it('names the field on RegistryInvalid, not only in the message', () => {
    // The verbs answer "refuses, with the field named" (§10); a machine-readable
    // field is what lets the PATCH route in Plan 3a point at the right control.
    try {
      const r = good(); r['subagent'] = 'fable';
      parseRegistry(r);
      expect.unreachable('parseRegistry accepted a subagent on a null slot');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryInvalid);
      expect((e as RegistryInvalid).field).toBe('subagent');
    }
  });

  it('refuses every one of a batch of invalid registries', () => {
    // Fix round 1: this ran the same batch through both implementations before
    // the single-source ruling. One implementation, one pass — still worth
    // bundling as a batch, since each mutation is a distinct refusal path.
    const bad: Record<string, unknown>[] = [];
    const push = (mut: (r: Record<string, unknown>) => void): void => {
      const r = good(); mut(r); bad.push(r);
    };
    push((r) => { r['probe'] = 'gemini'; });
    push((r) => { r['subagent'] = 'fable'; });
    push((r) => { r['discovery'] = []; });
    push((r) => { delete r['classes']; });
    push((r) => { r['selectable'] = ['x']; });
    push((r) => { r['probe'] = 'openrouter'; });
    for (const r of bad) {
      expect(() => parseRegistry(r), JSON.stringify(r)).toThrow();
    }
  });
});

describe('familyClassOf', () => {
  it.each([
    ['claude-fable-5-1', 'fable'],
    ['claude-opus-5-20260801', 'opus'],
    ['claude-sonnet-5-20260514', 'sonnet'],
    ['claude-haiku-4-5-20250101', 'haiku'],
  ] as const)('%s is %s-class', (id, cls) => {
    expect(familyClassOf(id)).toBe(cls);
  });

  it('a model id with no family token is not classified', () => {
    expect(familyClassOf('gpt-5.6-sol')).toBeNull();
  });

  it('the tokens are matched with their DASHES, so a bare word does not match', () => {
    // `-opus-` and not `opus`: without the dashes a vendor id like `opusml/x`
    // would classify as an Anthropic family.
    expect(familyClassOf('opusml/x')).toBeNull();
    expect(familyClassOf('vendor/sonnetish')).toBeNull();
  });

  it('order is fable, opus, sonnet, haiku — the FIRST match wins', () => {
    expect(familyClassOf('claude-fable-opus-hybrid-1')).toBe('fable');
  });
});

describe('classOfModel', () => {
  it('reverse-looks an id up in the four slots', () => {
    expect(classOfModel(SEEDED, 'gpt-5.6-terra')).toBe('sonnet');
  });

  it('answers null for an id no class holds, and never matches a null slot', () => {
    expect(classOfModel(SEEDED, 'gpt-6-astra')).toBeNull();
    expect(classOfModel(SEEDED, '')).toBeNull();
  });

  it('the first class in CLASSES order wins when two slots hold one id', () => {
    const both = { ...SEEDED, classes: { haiku: 'x', sonnet: 'x', opus: null, fable: null } };
    expect(classOfModel(both, 'x')).toBe('haiku');
    expect(CLASSES[0]).toBe('haiku');
  });
});

describe('parseCatalogue', () => {
  const good = clone(CODEX);

  it('round-trips a written catalogue', () => {
    expect(parseCatalogue(good)).toEqual(CODEX);
  });

  it.each([
    ['a non-object', 7],
    ['an unknown probe kind', { ...CODEX, probe: 'gemini' }],
    ['the account-connections provider spelling', { ...CODEX, probe: 'openai' }],
    ['a missing fetchedAt', { ...CODEX, fetchedAt: undefined }],
    ['a non-array models', { ...CODEX, models: {} }],
    ['a model with no id', { ...CODEX, models: [{ label: 'x' }] }],
    ['a model with a non-string id', { ...CODEX, models: [{ id: 7, label: 'x' }] }],
  ] as const)('refuses %s', (_why, bad) => {
    expect(() => parseCatalogue(bad)).toThrow(CatalogueInvalid);
  });

  it('fills the optional fields rather than demanding them', () => {
    const bare = { probe: 'compatible', fetchedAt: 1, stale: false, models: [{ id: 'x' }] };
    expect(parseCatalogue(bare).models[0]).toEqual({
      id: 'x', label: 'x', context: null, maxContext: null,
      efforts: [], hidden: false, priceIn: null, priceOut: null,
    });
  });
});

describe('the sentinel prefix', () => {
  it('is what the materialiser writes for a null slot (§6.1)', () => {
    expect(UNAVAILABLE_PREFIX).toBe('ccrc-unavailable-');
    for (const c of CLASSES) expect(`${UNAVAILABLE_PREFIX}${c}`).toMatch(/^ccrc-unavailable-[a-z]+$/);
  });

  it('is NOT what anything here branches on, in either file', () => {
    // §6.1: the sentinel lives in a SINK. Availability is `available` in TS and
    // node and the TSV's third column in bash. A reader that tested for the
    // string would be a second, silent definition of "unavailable". Checked in
    // BOTH files since fix round 1: `shared/models.ts` now only RE-EXPORTS the
    // constant (one mention, the re-export line) and `shared/models.mjs` is
    // where it is actually defined (one mention, the `export const` line).
    for (const f of ['shared/models.ts', 'shared/models.mjs']) {
      const src = readFileSync(path.join(REPO, f), 'utf8');
      const uses = src.split('\n').filter((l) => l.includes('UNAVAILABLE_PREFIX'));
      expect(uses, f).toHaveLength(1);
    }
    const mjsSrc = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    expect(mjsSrc).toContain('export const UNAVAILABLE_PREFIX');
  });
});

describe('shared/models.ts is TypeScript-facing over the single models.mjs implementation', () => {
  it('imports exactly one thing — its own ./models.mjs — and nothing else (fix round 1)', () => {
    // Before fix round 1 this file imported NOTHING (a full duplicate
    // implementation). The controller ruling adopted single-source instead:
    // `shared/models.mjs` is the one implementation, and this file's only
    // external reference is the re-export from it. The PWA still bundles this
    // file with no `node:*` involved — `./models.mjs` is equally import-free.
    const src = readFileSync(path.join(REPO, 'shared/models.ts'), 'utf8');
    // Not line-anchored: the re-export is a multi-line `export { ... } from
    // './models.mjs';` block, so this matches the specifier wherever the
    // `from '...';` lands rather than requiring `import`/`export` on the same
    // line as it.
    const specifiers = [...src.matchAll(/\bfrom\s+'([^']+)';/g)].map((m) => m[1]!);
    expect(specifiers).toEqual(['./models.mjs']);
  });

  it('the .mjs carries the class list, and it is CLASSES element for element', () => {
    // Source-derived, `server/test/source-bytes.test.ts:5-15`'s rule: the
    // `.mjs` cannot import the `.ts`'s exported `CLASSES` (that would be an
    // import cycle), so it keeps a private copy, compared here as TEXT. The
    // last regex hand-copied between these two languages shipped as raw
    // control bytes with every suite green.
    const src = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    const m = /const CLASSES = \[([^\]]*)\];/.exec(src);
    expect(m, 'shared/models.mjs must declare `const CLASSES = [...];`').not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual([...CLASSES]);
  });

  it('the .mjs carries PROBE_KINDS, element for element', () => {
    const src = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    const m = /const PROBE_KINDS = \[([^\]]*)\];/.exec(src);
    expect(m, 'shared/models.mjs must declare `const PROBE_KINDS = [...];`').not.toBeNull();
    const mirrored = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    expect(mirrored).toEqual([...PROBE_KINDS]);
  });

  it('MODEL_ID_RE is the account-connections regex, SOURCE for source, in its one home', () => {
    // Round-2 ruling 2: copy that branch's regex with a comment naming its
    // origin, do not import from the branch. Fix round 1 moved the only
    // definition into `shared/models.mjs` (re-exported, not redeclared, by
    // `shared/models.ts`) — checked here as text against the ONE literal this
    // plan pins, for `source-bytes.test.ts`'s reason.
    const LITERAL = String.raw`/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/`;
    const src = readFileSync(path.join(REPO, 'shared/models.mjs'), 'utf8');
    expect(src, 'shared/models.mjs must spell MODEL_ID_RE exactly').toContain(`MODEL_ID_RE = ${LITERAL}`);
  });
});

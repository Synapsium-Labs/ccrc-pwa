// X2 Native Docs parity, Task P4.3 (spec 2026-11-18 section 4.5, row 5.4, section 7): the pure L0 half of the docs
// settings. The tracker rule checker, the one place a rule runs (`resolveItemLink`), the strict shape check for a stored
// row or a PUT body, and the one widening decision the server and the console both ask. No tracker name or host
// appears here: the fixtures use `tracker.example`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_DOCS_SETTINGS,
  TRACKER_ITEMS_MAX,
  TRACKER_ITEM_MAX_CHARS,
  TRACKER_PATTERN_MAX_CHARS,
  TRACKER_RULES_MAX,
  checkTrackerRule,
  checkTrackerRules,
  docsSettingsFromStored,
  parseDocsSettings,
  resolveItemLink,
  settingsWidening,
  type DocsSettings,
  type TrackerRule,
} from '../../shared/docsTracker.js';

const rule = (over: Partial<TrackerRule> = {}): TrackerRule => ({
  name: 'items',
  pattern: '([A-Z]+)-([0-9]+)',
  template: 'https://tracker.example/browse/{1}-{2}',
  ...over,
});

const settings = (rules: TrackerRule[] = [], defaultBranches: Record<string, string> = {}): DocsSettings => ({ rules, defaultBranches });

describe('tracker: the constants', () => {
  it('holds the spec bounds', () => {
    expect(TRACKER_PATTERN_MAX_CHARS).toBe(200);
    expect(TRACKER_RULES_MAX).toBe(20);
    expect(TRACKER_ITEM_MAX_CHARS).toBe(100);
    expect(TRACKER_ITEMS_MAX).toBe(50);
  });
  it('settings start empty', () => {
    expect(EMPTY_DOCS_SETTINGS).toEqual({ rules: [], defaultBranches: {} });
  });
});

describe('tracker: the template checker', () => {
  it.each([
    ['placeholder beside the host', 'https://tracker.example{1}/x'],
    ['placeholder beside the host before a query', 'https://tracker.example{1}?x=1'],
    ['placeholder at the start of the host', 'https://{1}.tracker.example/'],
    ['placeholder at the end of the host', 'https://tracker.{1}/'],
    ['the whole host a placeholder', 'https://{1}/x'],
    ['placeholder in the port', 'https://tracker.example:{1}/x'],
    ['placeholder in the userinfo name', 'https://{1}@tracker.example/x'],
    ['placeholder in the userinfo password', 'https://user:{1}@tracker.example/x'],
  ])('tracker: placeholder beside the host refused (%s)', (_label, template) => {
    expect(checkTrackerRule(rule({ template }))).toEqual({ ok: false, why: 'template-host' });
  });

  it.each([
    ['in the path', 'https://tracker.example/item/{1}'],
    ['straight after the first slash', 'https://tracker.example/{1}'],
    ['in the query', 'https://tracker.example/find?id={0}'],
    ['in the query with no path', 'https://tracker.example?id={0}'],
    ['in the fragment', 'https://tracker.example/page#{1}'],
    ['in all three', 'https://tracker.example/a/{1}?b={2}#{3}'],
    ['a port left fixed', 'https://tracker.example:8443/a/{1}'],
    ['no placeholder at all (one fixed URL, allowed)', 'https://tracker.example/board'],
  ])('tracker: placeholder positions accepted (%s)', (_label, template) => {
    expect(checkTrackerRule(rule({ template }))).toEqual({ ok: true });
  });

  it('tracker: http template refused', () => {
    expect(checkTrackerRule(rule({ template: 'http://tracker.example/item/{1}' }))).toEqual({ ok: false, why: 'template-scheme' });
  });

  it.each([
    ['a relative URL', '/item/{1}'],
    ['no scheme', 'tracker.example/item/{1}'],
    ['an empty template', ''],
    ['another scheme', 'ftp://tracker.example/{1}'],
    ['a javascript URL', 'javascript:alert({1})'],
    ['one scheme slash short', 'https:/tracker.example/{1}'],
    ['leading space', ' https://tracker.example/{1}'],
  ])('tracker: a template that is not an absolute https URL is refused (%s)', (_label, template) => {
    expect(checkTrackerRule(rule({ template }))).toEqual({ ok: false, why: 'template-scheme' });
  });

  it('tracker: an uppercase scheme is accepted', () => {
    expect(checkTrackerRule(rule({ template: 'HTTPS://tracker.example/{1}' }))).toEqual({ ok: true });
  });
});

describe('tracker: the pattern checker', () => {
  it('tracker: pattern matching empty refused', () => {
    for (const pattern of ['', 'a*', '(x)?', 'a|', '(?:)']) {
      expect(checkTrackerRule(rule({ pattern }))).toEqual({ ok: false, why: 'pattern-empty-match' });
    }
  });

  it('tracker: 201-character pattern refused', () => {
    expect(checkTrackerRule(rule({ pattern: 'a'.repeat(201) }))).toEqual({ ok: false, why: 'pattern-long' });
  });

  it('tracker: a 200-character pattern is accepted', () => {
    expect(checkTrackerRule(rule({ pattern: 'a'.repeat(200) }))).toEqual({ ok: true });
  });

  it('tracker: a pattern that does not compile is refused', () => {
    for (const pattern of ['(', '[a-', '*a', 'a{2,1}', '\\-']) {
      expect(checkTrackerRule(rule({ pattern }))).toEqual({ ok: false, why: 'pattern-invalid' });
    }
  });

  it('tracker: a pattern that would close the anchoring group is refused', () => {
    // `^(?:a)|(b)$` compiles, and its first branch would match "ax" unanchored at the end.
    expect(checkTrackerRule(rule({ pattern: 'a)|(b' }))).toEqual({ ok: false, why: 'pattern-invalid' });
  });

  it('tracker: the checker never tests a pattern against anything but the empty string', () => {
    // A catastrophic pattern passes the checker at once: the empty string ends it at the first step.
    const t0 = Date.now();
    expect(checkTrackerRule(rule({ pattern: '(a+)+b' }))).toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('tracker: the rule list checker', () => {
  it('tracker: 21 rules refused', () => {
    expect(checkTrackerRules(Array.from({ length: 21 }, () => rule()))).toEqual({ ok: false, why: 'too-many' });
  });

  it('tracker: 20 rules accepted', () => {
    expect(checkTrackerRules(Array.from({ length: 20 }, () => rule()))).toEqual({ ok: true });
  });

  it('names the first failing rule and its index', () => {
    const rules = [rule(), rule({ template: 'http://tracker.example/{1}' }), rule({ pattern: '(' })];
    expect(checkTrackerRules(rules)).toEqual({ ok: false, why: 'template-scheme', index: 1 });
  });

  it('accepts none', () => {
    expect(checkTrackerRules([])).toEqual({ ok: true });
  });
});

describe('tracker: resolveItemLink', () => {
  it('tracker: capture with / and ? is percent-encoded', () => {
    const r = rule({ pattern: '(.+)', template: 'https://tracker.example/item/{1}?from={0}#{1}' });
    const link = resolveItemLink([r], 'project-a', 'a/b?c=d#e');
    expect(link).toBe('https://tracker.example/item/a%2Fb%3Fc%3Dd%23e?from=a%2Fb%3Fc%3Dd%23e#a%2Fb%3Fc%3Dd%23e');
    // Whatever the value held, the link stays on the template's host.
    expect(new URL(link as string).host).toBe('tracker.example');
  });

  it('an unencodable capture has no link', () => {
    const r = rule({ pattern: '(.+)', template: 'https://tracker.example/item/{1}' });
    expect(resolveItemLink([r], 'project-a', '\uD800')).toBeNull();
  });

  it('a value holding a placeholder is not filled twice', () => {
    const r = rule({ pattern: '(.+)', template: 'https://tracker.example/{1}/{0}' });
    expect(resolveItemLink([r], 'project-a', '{0}')).toBe('https://tracker.example/%7B0%7D/%7B0%7D');
  });

  it('fills {0} with the whole match and {n} with capture n', () => {
    expect(resolveItemLink([rule()], 'project-a', 'ABC-12')).toBe('https://tracker.example/browse/ABC-12');
    const r = rule({ template: 'https://tracker.example/{0}/{2}/{1}' });
    expect(resolveItemLink([r], 'project-a', 'ABC-12')).toBe('https://tracker.example/ABC-12/12/ABC');
  });

  it('an unmatched or absent capture is the empty string', () => {
    const r = rule({ pattern: '(a)|(b)', template: 'https://tracker.example/x?a={1}&b={2}&c={5}' });
    expect(resolveItemLink([r], 'project-a', 'b')).toBe('https://tracker.example/x?a=&b=b&c=');
  });

  it('a template with no placeholder links one fixed URL', () => {
    const r = rule({ template: 'https://tracker.example/board' });
    expect(resolveItemLink([r], 'project-a', 'ABC-12')).toBe('https://tracker.example/board');
  });

  it('is anchored in full', () => {
    expect(resolveItemLink([rule()], 'project-a', 'xABC-12')).toBeNull();
    expect(resolveItemLink([rule()], 'project-a', 'ABC-12x')).toBeNull();
    expect(resolveItemLink([rule({ pattern: 'a' })], 'project-a', 'ab')).toBeNull();
  });

  it('a non-match is null', () => {
    expect(resolveItemLink([rule()], 'project-a', 'nothing')).toBeNull();
    expect(resolveItemLink([], 'project-a', 'ABC-12')).toBeNull();
  });

  it('the first match wins, in rule order', () => {
    const first = rule({ name: 'one', pattern: '[A-Z]+-[0-9]+', template: 'https://tracker.example/one/{0}' });
    const second = rule({ name: 'two', pattern: '[A-Z]+-[0-9]+', template: 'https://tracker.example/two/{0}' });
    expect(resolveItemLink([first, second], 'project-a', 'ABC-1')).toBe('https://tracker.example/one/ABC-1');
    expect(resolveItemLink([second, first], 'project-a', 'ABC-1')).toBe('https://tracker.example/two/ABC-1');
  });

  it('a rule that does not match falls through to the next', () => {
    const first = rule({ name: 'one', pattern: 'x[0-9]+', template: 'https://tracker.example/one/{0}' });
    const second = rule({ name: 'two', pattern: '[A-Z]+-[0-9]+', template: 'https://tracker.example/two/{0}' });
    expect(resolveItemLink([first, second], 'project-a', 'ABC-1')).toBe('https://tracker.example/two/ABC-1');
  });

  it('a rule naming projects applies to those projects only', () => {
    const scoped = rule({ name: 'scoped', template: 'https://tracker.example/scoped/{0}', projects: ['project-a'] });
    const open = rule({ name: 'open', template: 'https://tracker.example/open/{0}' });
    expect(resolveItemLink([scoped, open], 'project-a', 'ABC-1')).toBe('https://tracker.example/scoped/ABC-1');
    expect(resolveItemLink([scoped, open], 'project-b', 'ABC-1')).toBe('https://tracker.example/open/ABC-1');
    expect(resolveItemLink([scoped], 'project-b', 'ABC-1')).toBeNull();
  });

  it('an empty projects list applies everywhere', () => {
    expect(resolveItemLink([rule({ projects: [] })], 'project-z', 'ABC-1')).toBe('https://tracker.example/browse/ABC-1');
  });

  it('a value of 100 characters resolves and one of 101 is null', () => {
    const r = rule({ pattern: 'a+', template: 'https://tracker.example/{0}' });
    expect(resolveItemLink([r], 'project-a', 'a'.repeat(100))).toBe('https://tracker.example/' + 'a'.repeat(100));
    expect(resolveItemLink([r], 'project-a', 'a'.repeat(101))).toBeNull();
  });

  it('an empty value is null', () => {
    expect(resolveItemLink([rule({ pattern: 'a*' })], 'project-a', '')).toBeNull();
    expect(resolveItemLink([rule()], 'project-a', '')).toBeNull();
  });

  it('a rule that fails its own check is skipped, and never throws', () => {
    const bad = [
      rule({ pattern: '(' }),
      rule({ pattern: 'a*' }),
      rule({ template: 'http://tracker.example/{0}' }),
      rule({ template: 'https://tracker.example{0}' }),
      rule({ pattern: '.+', template: 'https://{0}/' }),
    ];
    for (const b of bad) expect(resolveItemLink([b], 'project-a', 'ABC-1')).toBeNull();
    expect(resolveItemLink([...bad, rule()], 'project-a', 'ABC-1')).toBe('https://tracker.example/browse/ABC-1');
  });
});

describe('settings: parseDocsSettings', () => {
  const good = () => ({
    rules: [{ name: 'items', pattern: '[A-Z]+-[0-9]+', template: 'https://tracker.example/{0}', projects: ['project-a'] }, { name: 'bare', pattern: 'x', template: 'https://tracker.example/y' }],
    defaultBranches: { 'project-a': 'main', 'project-b': 'release/1.2' },
  });

  it('accepts a well-formed body and answers fresh plain objects', () => {
    const input = good();
    const out = parseDocsSettings(input);
    expect(out).toEqual({ ok: true, settings: good() });
    if (!out.ok) throw new Error('unreachable');
    expect(out.settings).not.toBe(input);
    expect(out.settings.rules[0]).not.toBe(input.rules[0]);
    expect(out.settings.rules[0]!.projects).not.toBe(input.rules[0]!.projects);
    expect('projects' in out.settings.rules[1]!).toBe(false);
    expect(Object.getPrototypeOf(out.settings.defaultBranches)).toBe(Object.prototype);
  });

  it('accepts the empty settings', () => {
    expect(parseDocsSettings({ rules: [], defaultBranches: {} })).toEqual({ ok: true, settings: { rules: [], defaultBranches: {} } });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a number', 1],
    ['a missing rules key', { defaultBranches: {} }],
    ['a missing defaultBranches key', { rules: [] }],
    ['an extra top-level key', { rules: [], defaultBranches: {}, extra: 1 }],
    ['rules that is not an array', { rules: {}, defaultBranches: {} }],
    ['defaultBranches that is an array', { rules: [], defaultBranches: [] }],
    ['defaultBranches that is null', { rules: [], defaultBranches: null }],
  ])('refuses %s', (_label, body) => {
    expect(parseDocsSettings(body).ok).toBe(false);
  });

  it('a class instance is not a plain object', () => {
    class Box { rules = []; defaultBranches = {}; }
    expect(parseDocsSettings(new Box()).ok).toBe(false);
  });

  it.each([
    ['an extra key', (r: Record<string, unknown>) => { r.extra = 1; }],
    ['a missing name', (r: Record<string, unknown>) => { delete r.name; }],
    ['a missing pattern', (r: Record<string, unknown>) => { delete r.pattern; }],
    ['a missing template', (r: Record<string, unknown>) => { delete r.template; }],
    ['a numeric name', (r: Record<string, unknown>) => { r.name = 7; }],
    ['an empty name', (r: Record<string, unknown>) => { r.name = ''; }],
    ['a 65-character name', (r: Record<string, unknown>) => { r.name = 'n'.repeat(65); }],
    ['a name with a control character', (r: Record<string, unknown>) => { r.name = 'a\nb'; }],
    ['a numeric pattern', (r: Record<string, unknown>) => { r.pattern = 1; }],
    ['a numeric template', (r: Record<string, unknown>) => { r.template = 1; }],
    ['a 2049-character template', (r: Record<string, unknown>) => { r.template = 'https://tracker.example/' + 'a'.repeat(2025); }],
    ['projects that is a string', (r: Record<string, unknown>) => { r.projects = 'project-a'; }],
    ['projects that is explicitly undefined', (r: Record<string, unknown>) => { r.projects = undefined; }],
    ['a bad project name', (r: Record<string, unknown>) => { r.projects = ['bad name']; }],
    ['a project name with a slash', (r: Record<string, unknown>) => { r.projects = ['a/b']; }],
    ['a non-string project', (r: Record<string, unknown>) => { r.projects = [3]; }],
    ['65 projects', (r: Record<string, unknown>) => { r.projects = Array.from({ length: 65 }, (_, i) => 'p' + i); }],
  ])('refuses a rule with %s', (_label, mutate) => {
    const body = good();
    mutate(body.rules[0] as unknown as Record<string, unknown>);
    expect(parseDocsSettings(body).ok).toBe(false);
  });

  it('refuses a rule that is not an object', () => {
    expect(parseDocsSettings({ rules: ['x'], defaultBranches: {} }).ok).toBe(false);
    expect(parseDocsSettings({ rules: [null], defaultBranches: {} }).ok).toBe(false);
  });

  it('leaves a 201-character pattern and 21 rules to the rule checker, so a PUT names the reason', () => {
    const longPattern = parseDocsSettings({ rules: [rule({ pattern: 'a'.repeat(201) })], defaultBranches: {} });
    expect(longPattern.ok).toBe(true);
    const many = parseDocsSettings({ rules: Array.from({ length: 21 }, () => rule()), defaultBranches: {} });
    expect(many.ok).toBe(true);
    // ... but not without bound.
    expect(parseDocsSettings({ rules: [rule({ pattern: 'a'.repeat(5000) })], defaultBranches: {} }).ok).toBe(false);
    expect(parseDocsSettings({ rules: Array.from({ length: 101 }, () => rule()), defaultBranches: {} }).ok).toBe(false);
  });

  it.each([
    ['a bad project name', { 'bad name': 'main' }],
    ['an empty project name', { '': 'main' }],
    ['a non-string branch', { 'project-a': 3 }],
    ['an empty branch', { 'project-a': '' }],
    ['HEAD', { 'project-a': 'HEAD' }],
    ['a qualified ref', { 'project-a': 'refs/heads/main' }],
    ['a branch with ..', { 'project-a': 'a..b' }],
    ['a branch with a space', { 'project-a': 'a b' }],
    ['a branch ending in .lock', { 'project-a': 'x.lock' }],
    ['a branch of 201 characters', { 'project-a': 'a'.repeat(201) }],
  ])('refuses a default branch with %s', (_label, defaultBranches) => {
    expect(parseDocsSettings({ rules: [], defaultBranches }).ok).toBe(false);
  });

  it('refuses a __proto__ key, parsed from JSON, in the branches or in a rule', () => {
    const viaBranches = JSON.parse('{"rules":[],"defaultBranches":{"__proto__":"main"}}') as unknown;
    expect(parseDocsSettings(viaBranches).ok).toBe(false);
    const viaTop = JSON.parse('{"rules":[],"defaultBranches":{},"__proto__":{"x":1}}') as unknown;
    expect(parseDocsSettings(viaTop).ok).toBe(false);
    const viaRule = JSON.parse('{"rules":[{"name":"n","pattern":"a","template":"https://tracker.example/","__proto__":{"x":1}}],"defaultBranches":{}}') as unknown;
    expect(parseDocsSettings(viaRule).ok).toBe(false);
  });

  it('a project named like an Object.prototype member is an ordinary own key', () => {
    const out = parseDocsSettings({ rules: [], defaultBranches: { constructor: 'main' } });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(Object.hasOwn(out.settings.defaultBranches, 'constructor')).toBe(true);
    expect(Object.hasOwn(out.settings.defaultBranches, 'toString')).toBe(false);
  });

  it('refuses more than 500 default branches and accepts 500', () => {
    const many = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + i, 'main']));
    expect(parseDocsSettings({ rules: [], defaultBranches: many(500) }).ok).toBe(true);
    expect(parseDocsSettings({ rules: [], defaultBranches: many(501) }).ok).toBe(false);
  });

  it('does not run a rule: a bad pattern parses, the checker refuses it', () => {
    const out = parseDocsSettings({ rules: [rule({ pattern: '(' })], defaultBranches: {} });
    expect(out.ok).toBe(true);
    expect(checkTrackerRules((out as { settings: DocsSettings }).settings.rules)).toEqual({ ok: false, why: 'pattern-invalid', index: 0 });
  });
});

describe('settings: settingsWidening', () => {
  const a = rule({ name: 'a', template: 'https://tracker.example/a/{0}', projects: ['project-a'] });
  const b = rule({ name: 'b', pattern: 'b[0-9]+', template: 'https://tracker.example/b/{0}' });
  const c = rule({ name: 'c', pattern: 'c[0-9]+', template: 'https://tracker.example/c/{0}' });

  it.each([
    ['identical', settings([a, b], { 'project-a': 'main' }), settings([a, b], { 'project-a': 'main' }), false],
    ['both empty', settings(), settings(), false],
    ['add a rule', settings([a]), settings([a, b]), true],
    ['add the first rule', settings(), settings([a]), true],
    ['remove a rule', settings([a, b]), settings([a]), false],
    ['remove the first rule', settings([a, b, c]), settings([b, c]), false],
    ['remove the middle rule', settings([a, b, c]), settings([a, c]), false],
    ['remove every rule', settings([a, b]), settings(), false],
    ['change a host', settings([a]), settings([{ ...a, template: 'https://other.example/a/{0}' }]), true],
    ['change a template path', settings([a]), settings([{ ...a, template: 'https://tracker.example/z/{0}' }]), true],
    ['change a pattern', settings([a]), settings([{ ...a, pattern: '.+' }]), true],
    ['change a name', settings([a]), settings([{ ...a, name: 'renamed' }]), true],
    ['change projects', settings([a]), settings([{ ...a, projects: ['project-b'] }]), true],
    ['add projects to a rule that had none', settings([b]), settings([{ ...b, projects: ['project-a'] }]), true],
    ['drop projects from a rule that had some', settings([a]), settings([{ name: a.name, pattern: a.pattern, template: a.template }]), true],
    ['reorder two rules', settings([a, b]), settings([b, a]), true],
    ['remove one and reorder the rest', settings([a, b, c]), settings([c, b]), true],
    ['remove one and change another', settings([a, b]), settings([{ ...b, pattern: '.+' }]), true],
    ['add a duplicate of a rule', settings([a]), settings([a, a]), true],
    ['remove one of two duplicates', settings([a, a]), settings([a]), false],
    ['set a default branch', settings(), settings([], { 'project-a': 'main' }), true],
    ['set another default branch', settings([], { 'project-a': 'main' }), settings([], { 'project-a': 'main', 'project-b': 'dev' }), true],
    ['change a default branch', settings([], { 'project-a': 'main' }), settings([], { 'project-a': 'dev' }), true],
    ['unset a default branch', settings([], { 'project-a': 'main' }), settings(), false],
    ['unset one of two default branches', settings([], { 'project-a': 'main', 'project-b': 'dev' }), settings([], { 'project-a': 'main' }), false],
    ['remove a rule and unset a branch', settings([a], { 'project-a': 'main' }), settings(), false],
    ['remove a rule and set a branch', settings([a]), settings([], { 'project-a': 'main' }), true],
    ['set a branch named like a prototype member', settings(), settings([], { constructor: 'main' }), true],
  ])('%s -> %s', (_label, before, after, widening) => {
    expect(settingsWidening(before, after)).toBe(widening);
  });
});

describe('settings: docsSettingsFromStored (the decoder of the stored row)', () => {
  const body = JSON.stringify(settings([rule()], { 'project-a': 'main' }));

  it('an absent row is empty settings', () => {
    expect(docsSettingsFromStored({ kind: 'absent' })).toEqual({ ok: true, settings: EMPTY_DOCS_SETTINGS });
  });

  it('a good row decodes to its settings', () => {
    const want = settings([rule()], { 'project-a': 'main' });
    expect(docsSettingsFromStored({ kind: 'row', body, updatedAt: 10n })).toEqual({ ok: true, settings: want });
  });

  it('settings: an unreadable read is unreadable, never empty', () => {
    expect(docsSettingsFromStored({ kind: 'unreadable', detail: 'no such table: docs_settings' })).toEqual({ ok: false, why: 'unreadable' });
  });

  it.each([
    ['a body that is not JSON', '{not json'],
    ['a body that is not text', { rules: [], defaultBranches: {} }],
    ['a body of the wrong shape', JSON.stringify({ rules: 'x', defaultBranches: {} })],
    ['a body with an extra key', JSON.stringify({ rules: [], defaultBranches: {}, extra: 1 })],
  ])('settings: a row with %s is unreadable, never empty', (_label, b) => {
    expect(docsSettingsFromStored({ kind: 'row', body: b, updatedAt: 1 })).toEqual({ ok: false, why: 'unreadable' });
  });
});

describe('tracker: the module stays L0', () => {
  it('imports only other shared modules', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(path.join(here, '..', '..', 'shared', 'docsTracker.ts'), 'utf8');
    const specs: string[] = [];
    // `import x from 'a'`, `import 'a'`, `export ... from 'a'`, `import('a')` and `require('a')`.
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g)) specs.push(m[2]!);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s, `import of ${s}`).toMatch(/^\.\/[A-Za-z0-9_-]+(?:\.js)?$/);
  });
});

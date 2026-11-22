// The React singleton's three lists are one module (`vite.react-singleton.ts`), read by both configs that load @ccrc/ui's source:
// vite.config.ts (the app build and the hermetic run) and vitest.browser.config.ts (a browser file that renders ui components to
// static markup). A list restated in either config would drift, and drift fails only as "Invalid hook call" inside one test. The
// configs are loaded as vite loads them (see browser-leg.test.ts), and each must resolve to the module's lists.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfigFromFile, type UserConfig } from 'vite';
import { REACT_SINGLETON } from '../vite.react-singleton';

const PWA = path.join(import.meta.dirname, '..');
async function loadConfig(file: string): Promise<UserConfig> {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.join(PWA, file), PWA);
  if (loaded === null) throw new Error(`no config at ${file}`);
  return loaded.config;
}
const hermetic = await loadConfig('vite.config.ts');
const browser = await loadConfig('vitest.browser.config.ts');
const aliasOf = (c: UserConfig): Record<string, string> => c.resolve?.alias as Record<string, string>;
const inlineOf = (c: UserConfig): unknown => (c as { test?: { server?: { deps?: { inline?: unknown } } } }).test?.server?.deps?.inline;
const { '@': _app, ...hermeticAlias } = aliasOf(hermetic);

describe('the React singleton is one module, read by both configs', () => {
  it('the module names every react-calling package ui depends on in all three lists', () => {
    expect([...REACT_SINGLETON.dedupe]).toEqual(Object.keys(REACT_SINGLETON.alias).sort((a, b) => REACT_SINGLETON.dedupe.indexOf(a as never) - REACT_SINGLETON.dedupe.indexOf(b as never)));
    expect(Object.keys(REACT_SINGLETON.alias).indexOf('react-dom')).toBeLessThan(Object.keys(REACT_SINGLETON.alias).indexOf('react'));
  });
  it('every package in dedupe is covered by `inline`, by name or by a pattern (D-8186 A2)', () => {
    const covered = (pkg: string): boolean => REACT_SINGLETON.inline.some((i) => (typeof i === 'string' ? i === pkg : i.test(`node_modules/${pkg}/`)));
    // `react` and `react-dom` are the singleton itself, which node resolves from pwa's own tree; `@ccrc/ui` is the source that imports them.
    const uncovered = REACT_SINGLETON.dedupe.filter((d) => d !== 'react' && d !== 'react-dom' && !covered(d));
    expect(uncovered).toEqual([]);
  });
  it('vite.config.ts resolves to the module\'s lists (its own `@` alias beside them)', () => {
    expect(hermetic.resolve?.dedupe).toEqual([...REACT_SINGLETON.dedupe]);
    expect(hermeticAlias).toEqual({ ...REACT_SINGLETON.alias });
    expect(Object.keys(aliasOf(hermetic)).slice(-Object.keys(REACT_SINGLETON.alias).length)).toEqual(Object.keys(REACT_SINGLETON.alias));
    expect(inlineOf(hermetic)).toEqual([...REACT_SINGLETON.inline]);
  });
  it('vitest.browser.config.ts resolves to the same lists, and so equals vite.config.ts\'s', () => {
    expect(browser.resolve?.dedupe).toEqual([...REACT_SINGLETON.dedupe]);
    expect(aliasOf(browser)).toEqual({ ...REACT_SINGLETON.alias });
    expect(inlineOf(browser)).toEqual([...REACT_SINGLETON.inline]);
    expect(aliasOf(browser)).toEqual(hermeticAlias);
    expect(browser.resolve?.dedupe).toEqual(hermetic.resolve?.dedupe);
    expect(inlineOf(browser)).toEqual(inlineOf(hermetic));
  });
});

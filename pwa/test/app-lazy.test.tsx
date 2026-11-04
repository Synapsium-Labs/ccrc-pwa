// Console speed, task C1 (the link and the start): six big screens load on demand (spec 2026-11-04 §2.3). The entry
// imports none of them statically; a route that opens one shows the loading line, then the screen; a chunk that fails
// to load throws into the detail boundary, whose fallback is drawn instead of a blank pane.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';

/** The six, by module path as `app.tsx` names them. */
const LAZY = [
  './screens/SessionScreen',
  './screens/settings/SettingsFrame',
  './screens/AccountsScreen',
  './screens/RunsScreen',
  './screens/DigestScreen',
  './screens/HighlightMeasure',
] as const;

/** The screens that stay in the entry (spec §2.3): Docs, the programme, Mail, Archive and the Waiting routes. */
const EAGER = ['./screens/DocsScreen', './ledgers/ProgrammeScreen', './screens/MailScreen', './screens/ArchiveScreen',
  './ledgers/WaitingRoutes'] as const;

vi.mock('../src/screens/RunsScreen', () => ({ RunsScreen: (): ReactNode => <h1>runs (stand-in)</h1> }));
vi.mock('../src/screens/AccountsScreen', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

const APP = readFileSync(path.join(__dirname, '../src/app.tsx'), 'utf8');
/** Every module specifier of a static `import … from '…'` statement (a type-only import included: it loads nothing,
 *  but none of the six is imported for a type either). */
const staticImports = (src: string): string[] =>
  [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1] as string);
const dynamicImports = (src: string): string[] => [...src.matchAll(/\bimport\('([^']+)'\)/g)].map((m) => m[1] as string);

describe('the entry does not carry the six screens', () => {
  it('CONTROL: the scanners read a static and a dynamic import', () => {
    expect(staticImports("import { A } from './a';\nimport type {\n  B,\n} from './b';\n")).toEqual(['./a', './b']);
    expect(dynamicImports("const A = lazy(() => import('./a').then((m) => m));")).toEqual(['./a']);
  });

  it('the entry module graph imports none of the six screens', () => {
    const statics = staticImports(APP);
    expect(statics.length).toBeGreaterThan(10);
    expect(statics.filter((s) => (LAZY as readonly string[]).includes(s))).toEqual([]);
    expect(dynamicImports(APP).sort()).toEqual([...LAZY].sort());
  });

  it('the screens that stay eager are still static imports', () => {
    expect(EAGER.filter((s) => !staticImports(APP).includes(s))).toEqual([]);
  });
});

// A fresh import of the whole app graph per case: seconds on a loaded box, so a longer limit than vitest's 5 s.
describe('a lazy route', { timeout: 30_000 }, () => {
  let warn: MockInstance<typeof console.warn>;
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    // A fresh module graph per case, so each case is the first load of its chunk.
    vi.resetModules();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    const { navigate } = await import('../src/lib/router');
    navigate('/');
    warn.mockRestore();
    error.mockRestore();
  });

  it('navigating to /runs shows the fallback, then the screen', async () => {
    const { App } = await import('../src/app');
    const { navigate } = await import('../src/lib/router');
    render(<App />);
    act(() => { navigate('/runs'); });
    const pane = document.querySelector('.shell-detail') as HTMLElement;
    expect(pane).toContainElement(screen.getByText('Loading…'));
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('This screen could not be shown.')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'runs (stand-in)' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('a chunk that fails to load shows the detail boundary’s fallback, not a blank pane', async () => {
    const { App } = await import('../src/app');
    const { navigate } = await import('../src/lib/router');
    render(<App />);
    act(() => { navigate('/accounts'); });
    const pane = document.querySelector('.shell-detail') as HTMLElement;
    expect(pane).toContainElement(await screen.findByText('This screen could not be shown.'));
    expect(screen.getByRole('button', { name: 'Back to the fleet' })).toBeInTheDocument();
    expect(document.querySelector('.shell-nav'), 'the shell stays').not.toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.anything());
  });
});

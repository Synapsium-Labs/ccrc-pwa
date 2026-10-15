// M4.B4, the root boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's refinement
// (m)). Runs `main.tsx` ITSELF, not a copy of what it renders: the file plants `#root`, mocks the two modules whose
// import has effects this test does not want (`virtual:pwa-register`, the service-worker registration) or whose
// output it replaces (`../src/app`, an `App` that throws while rendering), then imports `../src/main`, which renders
// into `#root` exactly as the browser's entry does. Before the boundary, the throw unmounted the whole root and left
// a blank page (section 0, defect 3); with it, the page says so and offers Reload.
//
// Its own file because both mocks are per-file, and because importing `main.tsx` mounts a root that nothing
// unmounts: vitest isolates each test file, so that root ends with this file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, screen } from '@testing-library/react';

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));
vi.mock('../src/app', () => ({
  App: (): never => {
    throw new Error('boom');
  },
}));

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
/** What importing main.tsx threw, if anything. Without the boundary, React rethrows the App's error out of `act`;
 *  it is kept here so each case fails on its own assertion rather than the whole file failing in its setup. */
let importThrew: { error: unknown } | null = null;

beforeAll(async () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports the error the boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  try {
    await act(async () => {
      await import('../src/main');
    });
  } catch (e) {
    importThrew = { error: e };
  }
});

afterAll(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('main.tsx wraps <App/> in the root boundary (M4.B4)', () => {
  it('an App that throws while rendering shows "ccrc could not draw this screen." and a Reload button, inside #root', () => {
    expect(importThrew, 'the throw stayed inside the root boundary').toBeNull();
    const root = document.getElementById('root') as HTMLElement;
    expect(root).toContainElement(screen.getByText('ccrc could not draw this screen.'));
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(root).toContainElement(reload);
    expect(reload).toHaveClass('btn-primary');
  });

  it("the boundary logged the throw as the root's", () => {
    expect(importThrew, 'the throw stayed inside the root boundary').toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in root', expect.objectContaining({ message: 'boom' }));
  });
});

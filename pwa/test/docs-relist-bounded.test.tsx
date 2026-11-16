// Docs W5 part 1, review 450 F4: the re-list waiter test and the follow-up GET, pinned by a BOUNDED case.
// Why this is its own file: the guards pinned here (the `hasRelistWaiters(key)` test before the follow-up GET in
// `applyTreeGet`, and the `relistAfter !== null` half of the test inside `hasRelistWaiters`, deleted or inverted)
// cannot be mutated under the other visit files' loaders. The `e.treeKey === tKey` half is not pinned here: this
// case has one tree key, so dropping it changes nothing the case can see. Those answer every GET at once, so with
// any of these guards removed the visit re-lists without bound and crashes the test worker, and a mutation row naming
// those files measures a crash, not a red case. Here the tree loader answers twice and then never settles, so an
// unconditional follow-up GET is one extra call, counted and failed on: the rows name only this file.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DocsPageLocation } from '../../shared/docs';
import { clearAuthLost } from '../src/lib/auth';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import type { DocsLoaders } from '../src/docs/failures';
import { fakeLoaders, okTree, pageAt } from './docsFixtures';

afterEach(() => {
  cleanup();
  clearAuthLost();
});

/** Let every answer already resolved land, and the renders and effects it causes run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

function visit(loaders: DocsLoaders, url: string) {
  return renderHook(
    (p: { page: DocsPageLocation }) => useDocsVisit(p.page, loaders),
    { initialProps: { page: pageAt(url) } },
  );
}

describe('a GET that answered with no read waiting for a re-list makes no follow-up GET (bounded)', () => {
  it('a leaf that read ok, then one Retry: the tree loader is called exactly twice', async () => {
    const f = fakeLoaders();
    f.tree.mockReset();
    f.tree.mockResolvedValueOnce(okTree()).mockResolvedValueOnce(okTree()).mockImplementation(() => new Promise(() => {}));
    const { result } = visit(f.loaders, '/docs/demo/specs/a.md');
    await flush();
    expect(result.current.file.s).toBe('ok');
    act(() => result.current.retryTree());
    await flush();
    await flush();
    expect(f.tree).toHaveBeenCalledTimes(2);
  });
});

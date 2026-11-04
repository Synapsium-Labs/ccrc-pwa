// The browser config's global setup: the production PWA is built ONCE per vitest run, before any browser file starts,
// and every file serves that one output (`app.ts`'s `sharedDist`). Before this, 47 of the 48 browser files ran their
// own `vite build` in `beforeAll`, each into a temporary directory of its own: the same tree built 47 times a run, up
// to three at once, about three minutes of each CI shard's wall time. The build is a function of the tree alone, so one
// build serves every file the bytes its own build did.
//
// vitest runs a global setup once per run in its main process, so under CI's `--shard=i/n` each shard builds once.
// The output is shared, so it is SEALED read-only before any file sees it (`sealDist`): a file that wrote into it
// would change what every later file serves, which a per-file build could never do. A failed build fails the run
// here, before any file starts, with the build's own error, and leaves no directory behind; the teardown removes the
// build after the last file. `vitest.browser.config.ts` names it as the browser config's global setup. Pinned by
// test/browser-dist.test.ts.
import { DIST_KEY, buildDist, removeDist, sealDist } from './dist';

/** What the setup needs of vitest's `TestProject`. */
export interface ProvidingProject {
  provide(key: typeof DIST_KEY, value: string): void;
}

/** The global setup over `build` (`buildDist` in a run; a stand-in in the hermetic pins). */
export function buildOnce(build: () => string = buildDist) {
  return (project: ProvidingProject): (() => void) => {
    const started = performance.now();
    const dist = build();
    try {
      sealDist(dist);
      project.provide(DIST_KEY, dist);
    } catch (e) {
      removeDist(dist);
      throw e;
    }
    process.stderr.write(`browser leg: built the PWA once in ${Math.round(performance.now() - started)} ms, sealed read-only\n`);
    return () => removeDist(dist);
  };
}

export default buildOnce();

// Draft review's L2 port: the one thing the review sweep needs from outside, declared by its consumer (the review
// context), not by the docs reader that happens to implement it. No door holds it: the read door never reads the
// fleet (spec T7, M-X3.6), and the create door takes the bytes the owner's browser built.

import type { DocsTreeOk } from '../../../shared/docs.js';

/** Reads a project's docs tree at one served ref, so a share's source can be re-measured against what is committed.
 *
 *  Failure contract: ANY failure (an unknown project, an unresolvable ref, a timeout, a refused read) is
 *  `{ ok: false }`, never a throw. The port keeps no finer distinction because the one caller treats every failure the
 *  same way: the verdict is `unmeasured` and nothing is removed on a guess. */
export interface ReviewTreeReader {
  tree(project: string, servedRef: string): Promise<{ ok: true; tree: DocsTreeOk } | { ok: false }>;
}

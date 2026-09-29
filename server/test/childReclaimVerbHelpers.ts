// Shared fixtures for the `ws-reclaim` verb suite (spec 2026-09-22 §5.5-§5.6),
// split across `ccd-child-reclaim-verb.test.ts`, `-tail.test.ts` and
// `-reflogs.test.ts` — task 1b of wave 4 (600s foreground ceiling). Each of
// those files declares its own `let h: PrHarness` (a fresh fixture HOME per
// `beforeEach`, torn down per `afterEach`) and calls `verbHelpers(() => h)`
// once, so every helper below reads the CURRENT harness of whichever file
// calls it — never a module-level `h` shared across files.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, type Child } from './childReclaimFixture.js';

export const verbHelpers = (getH: () => PrHarness) => {
  const reg = (field: string): string => path.join(getH().home, '.cc-sessions', `${CHILD_ID}.${field}`);
  const tombOf = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(getH().home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as Record<string, unknown>;
  const atticShas = (c: Child): string[] =>
    getH().git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
      .split('\n').filter(Boolean).map((r) => r.split('/').pop()!);
  const KILL = `tmux kill-session -t =cc-${CHILD_ID}:`;   // the exact target (D-3525)
  const unsupervised = (): string[] => getH().calls().filter((l) => l.startsWith('unsupervise'));

  /** Everything a refusal must leave standing. */
  const intact = (c: Child): void => {
    expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
    expect(getH().git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(getH().reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(getH().calls(), 'the pane was not touched').not.toContain(KILL);
  };
  const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
    expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(o['reclaimed'], 'a refusal never also reports a reclaim').toBeUndefined();
    return String(o['refused']);
  };
  /** A previous reclaim that died right after its pin phase wrote the tombstone
   *  and the breadcrumb — and before its tail unsupervised or killed anything. */
  const interrupted = (c: Child, phase: string): void => {
    getH().sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
      + ` && _reg_set ${CHILD_ID} reaping reclaim:${phase}`);
    expect(getH().reg(CHILD_ID, 'reaping')).toBe(`reclaim:${phase}`);
  };
  const resumeToken = (phase: string): string =>
    getH().sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
  /** Point BOTH the registry row and the record the pin wrote at another
   *  project and/or workdir — so they agree, and the rung under test is the one
   *  that answers, not the agreement rung. */
  const repoint = (project: string | undefined, workdir: string): void => {
    if (project !== undefined) fs.writeFileSync(reg('project'), project);
    fs.writeFileSync(reg('workdir'), workdir);
    getH().sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify(project === undefined ? { workdir } : { project, workdir })}'`);
  };
  /** The journal row and the stdout document of a failure say ONE detail. */
  const failedPairAgrees = (r: { stdout: string }): void => {
    const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
    const row = eventsOf(getH().home, 'reclaim').filter((e) => e['outcome'] === 'failed').pop()!;
    expect(row['refusal'], 'the journal names the failure the document names').toBe(doc.failed);
    expect(row['detail'], 'the journal and the document carry one detail').toBe(doc.detail);
  };
  /** Every entry under `dir` — path, type, mode, bytes — or `gone`. */
  const treeOf = (dir: string): string[] | 'gone' => {
    if (!fs.existsSync(dir)) return 'gone';
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const n of fs.readdirSync(d).sort()) {
        if (n === '.git') continue;
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        const rel = path.relative(dir, p);
        if (st.isDirectory()) { out.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
        else out.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
      }
    };
    walk(dir);
    return out;
  };

  return { reg, tombOf, atticShas, KILL, unsupervised, intact, refusedWith, interrupted, resumeToken, repoint, failedPairAgrees, treeOf };
};

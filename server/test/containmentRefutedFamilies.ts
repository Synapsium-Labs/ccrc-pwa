// The PROVEN refusals of `_ws_reclaim_owned` (child reclamation wave 7, spec
// §5.6) — ten shapes in its five arm families — shared by the ws-reclaim and
// ws-expire suites, because the tail they exercise is one tail. Each shape is
// BASH, run in the sourced ccd shell: between a resume token and the verb (a
// resumed arm), or inside the tail's first act (`seam`, a fresh arm, after the
// ladder passed and the pin and the breadcrumb were written).
// FIXTURE HOME ONLY: every path below is under `h.home`.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';

export interface Subject { readonly id: string; readonly wt: string; readonly main: string }
export interface Target extends Subject { readonly act: 'reclaim' | 'expire'; readonly branch: string }
export interface Run { readonly code: number; readonly stdout: string; readonly stderr: string }
export interface Shape {
  /** The bash that makes the shape; every statement `;`-terminated, nothing on stdout. */
  readonly plant: string;
  /** A substring of the tail's detail: this arm's `_WS_OWNED_WHY`. */
  readonly why: string;
  /** Another session's work, which the refusal must leave standing. */
  readonly keeps: readonly string[];
  /** Whether the subject's own tree still stands at its workdir once planted. */
  readonly treeStands: boolean;
}
export interface Family { readonly name: string; readonly make: (h: PrHarness, s: Subject) => Shape }

const reg = (h: PrHarness, file: string): string => path.join(h.home, '.cc-sessions', file);
/** Another session's STANDING registry row: its two files, as `ccd start` writes them. */
const rowSh = (h: PrHarness, id: string, workdir: string): string =>
  `printf '%s' 'u-${id}' > "${reg(h, `${id}.uuid`)}"; printf '%s' "${workdir}" > "${reg(h, `${id}.workdir`)}";`;
/** The subject's row AND the record its pin wrote, re-pointed together, so the agreement rung passes. */
const repointSh = (h: PrHarness, s: Subject, project: string | undefined, workdir: string): string =>
  (project === undefined ? '' : `printf '%s' '${project}' > "${reg(h, `${s.id}.project`)}"; `)
  + `printf '%s' "${workdir}" > "${reg(h, `${s.id}.workdir`)}"; `
  + `_ws_tombstone_patch ${s.id} '${JSON.stringify(project === undefined ? { workdir } : { project, workdir })}' >/dev/null;`;
/** `projects/demo2`: a LINKED worktree of the subject's repository, used as a project directory. */
const linkedProject = (h: PrHarness, s: Subject): string => {
  const demo2 = path.join(h.home, 'projects', 'demo2');
  h.git(s.main, 'worktree', 'add', '-q', '-b', 'proj2-main', demo2);
  return demo2;
};

export const FAMILIES: readonly Family[] = [
  { name: 'SHARED: another registry row names the workdir', make: (h, s) => ({
    plant: rowSh(h, 'demo-twin', s.wt), why: `${s.wt} is also named by registry row(s) demo-twin`, keeps: [], treeStands: true }) },
  { name: 'NESTED: a registry row rooted inside the worktree', make: (h, s) => {
    const root = path.join(s.wt, 'server');
    return { plant: `mkdir -p "${root}"; printf live > "${root}/live.txt"; ${rowSh(h, 'demo-nested', root)}`,
      why: 'registry row(s) demo-nested rooted inside', keeps: [path.join(root, 'live.txt')], treeStands: true };
  } },
  { name: 'NESTED: a registry row inside the temp root, a leaf the tail removes', make: (h, s) => {
    const root = path.join(h.home, '.cc-tmp', s.id, 'wt');
    return { plant: `mkdir -p "${root}"; printf live > "${root}/live.txt"; ${rowSh(h, 'demo-nested', root)}`,
      why: 'registry row(s) demo-nested rooted inside', keeps: [path.join(root, 'live.txt')], treeStands: true };
  } },
  { name: 'THROUGH: a registry row spelled through the workdir', make: (h, s) => ({
    plant: rowSh(h, 'demo-up', `${s.wt}/..`),
    why: `registry row(s) demo-up spell their workdir through ${s.wt}, not as one plain path`, keeps: [], treeStands: true }) },
  { name: 'MOVED: a gone row’s tree moved inside the child', make: (h, s) => {
    h.makeGhRepo('demo2', 'o/r2');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
    const wt2 = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.writeFileSync(path.join(wt2, 'precious.txt'), 'uncommitted work of the other session\n');
    const moved = path.join(s.wt, 'vendor', 'still-harbor');
    return { plant: `mkdir -p "${path.dirname(moved)}"; mv "${wt2}" "${moved}";`,
      why: 'registry row demo2-still-harbor, whose workdir is gone', keeps: [path.join(moved, 'precious.txt')], treeStands: true };
  } },
  { name: 'MAIN: the workdir is the project’s main checkout', make: (h, s) => {
    const demo2 = linkedProject(h, s);
    fs.writeFileSync(path.join(s.main, 'main-work.txt'), 'the project’s own uncommitted work\n');
    return { plant: repointSh(h, s, 'demo2', s.main), why: `${s.main} is ${demo2}'s main checkout`,
      keeps: [path.join(s.main, 'main-work.txt')], treeStands: true };
  } },
  { name: 'PROJECT: the workdir is the project directory itself', make: (h, s) => {
    const demo2 = linkedProject(h, s);
    fs.writeFileSync(path.join(demo2, 'proj-work.txt'), 'the project’s own uncommitted work\n');
    return { plant: repointSh(h, s, 'demo2', demo2), why: `${demo2} is the project directory ${demo2} itself`,
      keeps: [path.join(demo2, 'proj-work.txt')], treeStands: true };
  } },
  { name: 'LINK: a symbolic link to another worktree stands at the workdir', make: (h, s) => {
    const other = path.join(h.home, 'other');
    h.git(s.main, 'worktree', 'add', '-q', '--detach', other, 'main');
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session’s uncommitted work\n');
    return { plant: `rm -rf "${s.wt}"; ln -s "${other}" "${s.wt}";`, why: `${s.wt} is a symbolic link`,
      keeps: [path.join(other, 'dirty.txt')], treeStands: false };
  } },
  { name: 'NOT A DIRECTORY: a file stands at the workdir', make: (_h, s) => ({
    plant: `rm -rf "${s.wt}"; printf 'not a tree' > "${s.wt}";`, why: `something that is not a directory stands at ${s.wt}`,
    keeps: [s.wt], treeStands: false }) },
  { name: 'NOT PLAIN: the recorded workdir is not one plain path', make: (h, s) => ({
    plant: repointSh(h, s, undefined, `${s.wt}/`), why: 'not one plain absolute path', keeps: [], treeStands: true }) },
];

/** The tail's first act, `_ws_unsupervise` (recorded, as `CHILD_STUBS` records it), redefined to plant a shape. */
export const seam = (plant: string): string =>
  `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; : > "$HOME/seam-ran"; ${plant} };`;
export const seamRan = (h: PrHarness): boolean => fs.existsSync(path.join(h.home, 'seam-ran'));

const stopped = (h: PrHarness, r: Run, t: Target, word: string, why: string,
  keeps: readonly string[], treeStands: boolean, phase: string): Record<string, unknown> => {
  // What is on disk FIRST: a tail that went on past its stop shows here.
  for (const f of keeps) expect(fs.existsSync(f), `${f} stands: another session’s work — ${r.stdout}`).toBe(true);
  if (treeStands) {
    for (const f of ['f1.txt', 'f2.txt']) {
      expect(fs.existsSync(path.join(t.wt, f)), `the ${t.act}’s own ${f} stands — ${r.stdout}`).toBe(true);
    }
  }
  expect(h.git(t.main, 'branch', '--list', t.branch), 'its branch stands').toContain(t.branch);
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${t.id}.json`)), 'the tombstone stands').toBe(true);
  expect(h.reg(t.id, 'uuid'), 'the registry row stands').not.toBeNull();
  expect(h.reg(t.id, 'reaping'), 'the breadcrumb stays, for the retry').toBe(`${t.act}:${phase}`);
  expect(h.calls(), 'the session was stopped before the re-ask').toContain(`tmux kill-session -t =cc-${t.id}:`);
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const doc = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(doc['failed'], String(doc['detail'])).toBe(word);
  expect(doc['refused'], 'a failure after the act started, never a refusal').toBeUndefined();
  expect(String(doc['detail'])).toContain(why);
  expect(String(doc['detail'])).toContain('nothing further was deleted');
  const row = eventsOf(h.home, t.act).filter((e) => e['outcome'] === 'failed').pop();
  expect(row, 'the failure is journaled').toBeDefined();
  expect([row!['refusal'], row!['verb'], row!['detail']], 'the journal row and the document say one word and one detail')
    .toEqual([word, `ws-${t.act}`, doc['detail']]);
  return doc;
};

/** A PROVEN refusal: `containment-refuted`, the session stopped, nothing further deleted. */
export function assertRefuted(h: PrHarness, r: Run, t: Target, shape: Shape, phase: string): void {
  stopped(h, r, t, 'containment-refuted', shape.why, shape.keeps, shape.treeStands, phase);
}
/** A question that could not be asked: still `worktree-remove-failed`, today's detail. */
export function assertUnproven(h: PrHarness, r: Run, t: Target, why: string, phase: string): void {
  const doc = stopped(h, r, t, 'worktree-remove-failed', why, [], true, phase);
  expect(String(doc['detail'])).toContain('ccd cannot prove the tree at that path is');
}

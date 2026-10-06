/**
 * `ccd pr-state --project`'s merge-queue read (landing-order wave 2, spec §5.2):
 * one GraphQL query per repository per sweep, under its own timeout, answering
 * `queued | dequeued | landed | none | unmeasured` in an additive `queue` field
 * on every full line — and never costing a row, a phase or a `checks` value.
 *
 * FIXTURE HOMEs ONLY (`makePrHarness`). `gh` is a shell function here, so it
 * answers before PATH does; a snippet that forgot it would meet the base
 * harness's poisoned `gh`, never the host's real token.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prqueue-'); });
afterEach(() => { h.cleanup(); });

/** The seconds ccd assigns to a bare `NAME=<n>` constant — read, never
 *  hardcoded, for `ccd-pr-state.test.ts`'s reason: these assertions are about
 *  WHICH timeout wraps WHICH call. */
const ccdSeconds = (name: string): number => {
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(readFileSync(CCD, 'utf8'));
  if (!m) throw new Error(`ccd no longer defines ${name} as a bare integer assignment`);
  return Number(m[1]);
};

/** A workspace with one commit on its branch; returns the tip the binding
 *  check is pointed at (`ccd-pr-state.test.ts`'s fixture, returning the tip). */
const workspaceWithCommit = (project: string, slug: string): string => {
  h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', 'the work');
  return h.git(wt, 'rev-parse', 'HEAD');
};

const openRow = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  mergedRow({ state: 'OPEN', mergedAt: null, mergeCommit: null, ...over });

type Act = 'AddedToMergeQueueEvent' | 'RemovedFromMergeQueueEvent' | null;
const node = (number: number, state: 'OPEN' | 'MERGED', entry: boolean, act: Act,
  at = '2026-09-23T10:00:00Z'): Record<string, unknown> => ({
  number, state, mergeQueueEntry: entry ? { state: 'QUEUED' } : null,
  timelineItems: { nodes: act === null ? [] : [{ __typename: act, createdAt: at }] },
});
const answer = (open: unknown[], merged: unknown[] = []): string =>
  JSON.stringify({ data: { repository: { open: { nodes: open }, merged: { nodes: merged } } } });

/** A `gh` that tells the queue query apart from the two `pr list` calls by its
 *  first two words, logs every call's argv on one line to `gh-calls` (as the
 *  shared stub does) and the queue call's argv NUL-separated to `gh-queue-argv`
 *  — the query is multi-line, so only the NUL form can be asserted token by
 *  token. `graphqlArm` is what the queue call does. */
const queueGh = (graphqlArm: string): string => `
gh() {
  printf '%s\\n' "$1 $2" >> "$HOME/gh-calls"
  if [[ "$1 $2" == 'api graphql' ]]; then
    printf '%s\\0' "$@" > "$HOME/gh-queue-argv"
    ${graphqlArm}
    return
  fi
  [[ -f "$HOME/gh-rows.json" ]] && cat "$HOME/gh-rows.json"
  return 0
};
timeout() { case "$1" in -*) return 125 ;; esac; printf 'timeout %s %s %s %s\\n' "$1" "$2" "$3" "$4" >> "$HOME/gh-calls"; shift; "$@"; };
`;
const ANSWERS = 'cat "$HOME/gh-queue.json"';
const setQueue = (body: string): void => { fs.writeFileSync(path.join(h.home, 'gh-queue.json'), body); };

const lines = (out: string): Record<string, any>[] =>
  out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
const sweep = (arm = ANSWERS): Record<string, any> =>
  lines(h.sh(`${queueGh(arm)} cmd_pr_state --project demo`))[0]!;

describe('pr-state --project reads the merge queue once per sweep', () => {
  it('makes one GraphQL call, under PR_GH_QUEUE_TIMEOUT, with owner and name as raw -f variables', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    h.sh(`${queueGh(ANSWERS)} cmd_pr_state --project demo`);
    // ONE per repository per sweep — two workspaces, still one call.
    expect(h.ghCalls().filter((c) => c === 'api graphql')).toHaveLength(1);
    expect(h.ghCalls()).toContain(`timeout ${ccdSeconds('PR_GH_QUEUE_TIMEOUT')} gh api graphql`);
    const argv = readFileSync(path.join(h.home, 'gh-queue-argv'), 'utf8').split('\0').filter(Boolean);
    expect(argv.slice(-4)).toEqual(['-f', 'owner=o', '-f', 'name=r']);
    // `-F` reads `@file` and coerces types; nothing here may use it.
    expect(argv).not.toContain('-F');
    const q = argv.find((a) => a.startsWith('query='))!;
    expect(q).toContain('mergeQueueEntry');
    expect(q).toContain('REMOVED_FROM_MERGE_QUEUE_EVENT');
    expect(q).toContain('ADDED_TO_MERGE_QUEUE_EVENT');
    // The NEWEST hundred open PRs, in `gh pr list`'s own order: unordered,
    // GitHub answers the OLDEST hundred and a busy repository's live PRs fall out.
    expect(q).toContain('open: pullRequests(first: 100, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC})');
    // The document is a constant: the slug is a variable, never text in it.
    expect(q).not.toContain('"o"');
    expect(q).toContain('$owner');
  });

  it('--session makes no queue call and its line carries no queue key — absence is the older-build answer', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    const o = lines(h.sh(`${queueGh(ANSWERS)} cmd_pr_state --session demo-quiet-basin`))[0]!;
    expect(h.ghCalls().filter((c) => c === 'api graphql')).toEqual([]);
    expect(o.phase).toBe('open');
    expect('queue' in o).toBe(false);
  });
});

describe('the five answers', () => {
  it('queued — OPEN with a queue entry, stamped with the last act', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent', '2026-09-23T10:00:00Z')]));
    const o = sweep();
    expect(o.queue).toBe('queued');
    expect(o.queueAt).toBe('2026-09-23T10:00:00Z');
    expect(o.phase).toBe('open');
  });

  it('dequeued — OPEN, no entry, last act a removal', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', '2026-09-23T11:30:00Z')]));
    const o = sweep();
    expect(o.queue).toBe('dequeued');
    expect(o.queueAt).toBe('2026-09-23T11:30:00Z');
  });

  it('landed — MERGED, last act the add', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    setQueue(answer([], [node(42, 'MERGED', false, 'AddedToMergeQueueEvent')]));
    expect(sweep().queue).toBe('landed');
  });

  it('none — a MERGED PR whose last queue act is a removal was merged BY HAND after the dequeue', () => {
    // The case the spec's "last REMOVED event" alone cannot tell from a
    // re-enqueued-then-landed PR: the last act of EITHER kind decides.
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    setQueue(answer([], [node(42, 'MERGED', false, 'RemovedFromMergeQueueEvent')]));
    const o = sweep();
    expect(o.queue).toBe('none');
    expect('queueAt' in o).toBe(false);
  });

  it('none — an OPEN PR that never met the queue, and a workspace with no bound PR', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, null)]));
    expect(sweep().queue).toBe('none');
    h.ghRows([]);
    expect(sweep().queue).toBe('none');
  });

  it('unmeasured — the bound PR is outside both windows', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(7, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    expect(sweep().queue).toBe('unmeasured');
  });

  it('drops a queueAt that is not shaped like a timestamp, and keeps the word', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', '$(reboot)')]));
    const o = sweep();
    expect(o.queue).toBe('dequeued');
    expect('queueAt' in o).toBe(false);
  });
});

describe('the queue read may not cost the rows', () => {
  it('a failed call says unmeasured on every line and leaves phase, number and rows alone', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    const o = sweep('return 1');
    expect(o.queue).toBe('unmeasured');
    expect(o.phase).toBe('open');
    expect(o.number).toBe(42);
    expect(o.rows).toHaveLength(1);
    // …and a workspace with NO bound PR is unmeasured too, never `none`: `none`
    // is a measured answer, and this sweep measured nothing about the queue.
    h.ghRows([]);
    expect(sweep('return 1').queue).toBe('unmeasured');
  });

  it('an answer that is not the query\'s shape is unmeasured, never none', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue('{"errors":[{"message":"Field \'mergeQueueEntry\' doesn\'t exist"}]}');
    expect(sweep().queue).toBe('unmeasured');
  });

  it('a stamping pass that fails prints the lines exactly as _pr_state_one did', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    const out = h.sh(`${queueGh(ANSWERS)} _pr_queue_py() { cat >/dev/null; return 1; }; cmd_pr_state --project demo`);
    const o = lines(out)[0]!;
    expect(o.phase).toBe('open');
    expect(o.number).toBe(42);
    expect('queue' in o).toBe(false);
  });

  it('passes a whole-repo failure object through untouched', () => {
    // `_gh_pr_list`'s own answer object is printed BEFORE the loop and never
    // reaches the stamp; a line with no `rows` is never stamped either.
    workspaceWithCommit('demo', 'quiet-basin');
    const out = h.sh(`${queueGh(ANSWERS)} gh() { printf '%s\\n' "$1 $2" >> "$HOME/gh-calls"; echo 'HTTP 504' >&2; return 1; }; cmd_pr_state --project demo`);
    expect(lines(out)).toEqual([{ phase: 'unknown', reason: 'unavailable' }]);
  });
});

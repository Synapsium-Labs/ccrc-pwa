// Child reclamation wave 9: what the operator documents say about the temp-root collector's lane (spec 2026-09-22
// §5.10, §8). The lane ships shadowed, so every sentence that said nothing composes the verb is gone, and the arming
// checklist stands where the operator reads it. Run 358's prose pins (`expiry-lane-prose`, `dead-coordinator-prose`)
// own the cleanup-pause sentences this wave extends; this wave runs them and never edits them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md';
// The capability item of the arming checklist, as the README's list and the spec's "Before arming" list both carry it
// (a fact the operator checks, never a step the server enforces). Without the final `;` or `.`, which the list sets.
const CAPABILITY_ITEM = '`ccd caps` on the box whose ccd the server drives (the fleet box under `CCRC_FLEET=remote`) lists both `collect-v1` and `reclaim-pause-v1`: without either the lane does not run at all, shadow included, so it writes no row and no line, and an empty shadow feed proves nothing';

describe('README: the temp-root collector', () => {
  const readme = flat('README.md');
  it('no sentence says the verb is inert or that nothing composes it', () => {
    for (const gone of ['shipped inert).**', 'no server code composes the verb until', 'nothing composes it yet',
      'nothing composes it in this build']) expect(readme, gone).not.toContain(gone);
  });
  it('says the lane composes it, shadowed behind a file nothing in the tree writes', () => {
    expect(readme).toContain("**The collector's lane (child reclamation wave 9) ships shadowed.**");
    expect(readme).toContain('until the operator touches that file by hand in the registry the server reads');
    expect(readme).toContain('and never composes `ws-collect`');
    expect(readme).toContain('only after two audits at least a sweep interval apart minted the same token');
    expect(readme).toContain('`$REG/reclaim-paused` stops the lane, shadow included');
    expect(readme).toContain('runs at most two learning audits and one act job');
    expect(readme).toContain('no act job, shadow included, is offered in the first eight minutes after the server starts');
  });
  it('says a flip is reported only for a change an act job sees, at its last check (spec §5.10)', () => {
    for (const gone of ['writes one feed row for each change', 'writes a feed row for each change', 'the next act job to read the file']) {
      expect(readme, gone).not.toContain(gone);
    }
    expect(readme).toContain('An act job reads the file only at its last check, once its second audit has licensed the act.');
    expect(readme).toContain('so the first act after a change it sees waits for two fresh audits');
    expect(readme).toContain('A change undone between two such reads is never seen and writes no row, and an arming writes its row only when the first id is ready to act');
  });
  it('carries the four-item checklist before arming', () => {
    expect(readme).toContain('**Before arming it**, read the shadow feed rows, and arm only when:');
    expect(readme).toContain(CAPABILITY_ITEM);
    expect(readme).toContain('every "would collect" names an orphan whose run is closed;');
    expect(readme).toContain('except the one for temp roots whose runs the coordination database cannot vouch for, which may stand once you have read it');
    expect(readme).toContain('you know that any process of this uid can touch `$REG/collect-lane-live`, as it can `expire-lane-live`, and that the lane reports a change only when an act job next reads the file, so a missing "now live" or "now shadowed" row means not yet seen, never unchanged');
    expect(readme).toContain('A change undone between two such reads is never seen and writes no row');
  });
  it('names the collector among what the cleanup pause stops, keeping run 358’s pinned words', () => {
    expect(readme).toContain('and the expiry of archived workspaces stops too, as does the dead-coordinator lane, and so does the temp-root collector’s lane');
    expect(readme).toContain('`ws-reclaim` and `ws-collect`, each token-gated the same way, are composed by the server alone');
  });
});

describe('the design spec', () => {
  const s = flat(SPEC);
  it('§5.10 describes the lane as built, and the inert sentences are gone', () => {
    expect(s).toContain("**The server's lane (wave 9), as built.**");
    expect(s).toContain('`$REG/collect-lane-live`');
    for (const gone of ['Wave 7 ships it inert, and no lane composes it until wave 9', 'a builder that nothing calls',
      'the lane audits every pass', "arried to wave 9's pre-flight list", "on every pass for the child's life"]) {
      expect(s, gone).not.toContain(gone);
    }
  });
  it('the audit budget pays one grace: about 73 seconds, 78 at the widest (as built, wave 9)', () => {
    expect(s).not.toContain('about 79 seconds');
    expect(s).toContain('about 73 seconds, or 78 at the widest grace');
  });
  it('says a flip is seen by the next act job to reach its last check, and lists the capabilities before arming (as built, wave 9)', () => {
    expect(s).not.toContain('Each flip is seen by the next act job to read the file');
    expect(s).toContain('A flip is seen by the next act job to reach its last check, which writes one feed row, clears every observation pair, and composes nothing.');
    expect(s).toContain(CAPABILITY_ITEM);
  });
  it('states the offer order, the start hold-off at the offer, the flat hold and the restart residual (as built, wave 9)', () => {
    expect(s).toContain("No act job, shadow's would-collect included, is offered within eight minutes of the lane's start.");
    expect(s).toContain('Each pass offers the act job first, to the earliest ripe id by its ripening instant and then id');
    expect(s).toContain('The pass never awaits a call it queued.');
    expect(s).toContain('A hold waits one ceiling flat.');
    expect(s).toContain('about eight extra journaled terminal audits or failing acts per such id');
  });
  it('Appendix A cites the presence constants at the lines that hold them', () => {
    const m = /`PRESENCE_REFRESH_MS = 15_000`, `PRESENCE_TTL_MS = 45_000` \(`shared\/api\.ts:(\d+)-(\d+)`\)/.exec(s);
    expect(m, 'the citation is gone').not.toBeNull();
    const api = readFileSync(path.join(root, 'shared/api.ts'), 'utf8').split('\n');
    expect(api[Number(m![1]) - 1]).toContain('export const PRESENCE_REFRESH_MS = 15_000;');
    expect(api[Number(m![2]) - 1]).toContain('export const PRESENCE_TTL_MS = 45_000;');
  });
});

describe('the programme’s rulings file', () => {
  const c = readFileSync(path.join(root, 'docs/superpowers/programs/child-reclamation-contract.md'), 'utf8');
  const at = c.indexOf('### §16 as built (wave 9, run 380)');
  // Flattened: the file wraps its sentences, so an unflattened `not.toContain` on a wrapped sentence can never red.
  const note = c.slice(at).replace(/\s+/g, ' ');
  // Every departure the fix wave and fix round 1 made, and every residual they stated, by slug.
  const FIX_SLUGS = ['a-collected-act-always-writes-its-row', 'box-lines-clear-when-their-ids-leave',
    'box-line-clears-need-both-listings-measured', 'a-registered-id-projects-no-item', 'outcome-detail-is-diagnostic',
    'r23-sweep-of-contract-and-ruling-tokens', 'no-pass-fails-shut-clear', 'fold-failure-resets-the-pair-and-floors',
    'a-refusal-or-die-episode-outlives-observations', 'older-answer-never-clears-a-newer-probe',
    'reader-made-words-are-ccrcs', 'destructive-builder-fence-reads-whole-files', 'arming-checklist-names-the-capabilities',
    'flip-rows-are-for-changes-an-act-job-sees', 'marker-removal-after-the-last-listing-still-composes',
    'settle-throw-before-the-slot-write-wedges-the-slot', 'a-retryable-refusal-says-once',
    'act-failure-rows-repeat-per-act', 'would-collect-verdict-collides',
    'registered-id-with-only-an-unparseable-record-stays-hidden', 'failed-flag-not-pinned-at-the-lane',
    'a-ccd-word-spelled-like-a-reader-word-reads-as-ccrcs'];
  it('carries the wave’s as-built note, naming slugs and no number', () => {
    expect(at, 'the as-built note is missing').toBeGreaterThan(-1);
    expect(note).not.toMatch(/\bD-\d/);
  });
  it('names every fix-wave and fix-round slug', () => {
    for (const slug of FIX_SLUGS) expect(note, slug).toContain(slug);
  });
  it('rules the seven open items, and strikes the one the fix wave retired', () => {
    expect(note).not.toContain("Left open for the coordinator's ruling");
    expect(note).toContain('Ruled at fix round 1');
    for (const slug of ['hold-presence-alternation-can-starve-attention', 'collectable-alternation-is-silent',
      'lane-silent-without-capabilities', 'flip-row-filed-under-a-job-id',
      'registered-id-with-a-kept-record-hidden-while-quarantine-is-unmeasured',
      'ccd-collect-budget-comment-sums-a-grace-per-probe', 'spec-ws-expire-crumb-sentence-after-wl-w6',
      'pass-scoped-box-lines-stand-until-the-next-call']) expect(note, slug).toContain(slug);
    expect(note).toContain('`pass-scoped-box-lines-stand-until-the-next-call` is struck: '
      + '`box-lines-clear-when-their-ids-leave` retired it.');
  });
  // The corrections line names every task's plan-text corrections, one bullet per task.
  const CORRECTION_SLUGS = ['attention-doc-pair-counts-the-collector', 'collect-many-word-type-pinned-by-ts-expect-error',
    'collect-l0-red-at-collection', 'step3-attention-case-reds-at-runtime', 'step3-tsc-shape-differs',
    't1-9-dated-directive-stays-consumed', 'lock-die-mixed-bash-lines-row-added', 't2-16-longer-id-row-reds',
    'population-header-in-task-2-style', 'licence-header-in-task-2-style', 'presence-null-already-red',
    'r23-sweep-of-contract-and-ruling-tokens', 'stuck-end-exported', 'would-collect-body-calls-collect-who',
    'watch-interim-empty-collector', 'outcome-detail-is-diagnostic', 'ccdargv-collect-docstrings-rewritten',
    'collect-lane-fields-beside-the-child-reclaim-lane', 'older-pass-guard-is-shadowed-by-the-prune',
    't7-38-act-queue-pinned-by-the-registry-listing-count', 't7-22-reds-as-a-timeout',
    'publish-docstring-returns-rewrapped', 'collect-act-cap-after-last-await-pinned', 'budget-test-pins-the-read-values',
    'census-title-control-pins-its-width', 'h6-scan-follows-the-reshaped-audit-site',
    'destructive-builder-fence-reads-whole-files', 'collect-lane-prose-pins', 'r92-section-7-lines-are-section-5-10s',
    'spec-stale-sentences-beyond-the-r92-list', 'spec-5-8-pause-sentence-untouched', 'no-pass-fails-shut-clear',
    'flip-rows-are-for-changes-an-act-job-sees', 'arming-checklist-names-the-capabilities',
    'task-10-shards-run-as-halves-after-an-oom', 'commit-subject-follows-the-frame',
    // Fix round 1's fold of the worker's new slugs into the per-task corrections.
    'changed-recently-row-uses-a-later-idleat', 'reasons-hide-row-per-test', 'records-in-doubt-takes-the-doubts',
    'collect-said-word-nullable', 'collect-read-what-exported', 'box-probe-stamp-is-a-new-map',
    'probes-read-where-they-live-mid-sequence', 'f4-answers-arrive-a-whole-interval-apart',
    'f4-step-5-hold-armed-after-the-probe-pass'];
  it('names every task’s plan-text corrections on the one corrections line', () => {
    const from = note.indexOf('**Plan-text corrections and measured red shapes**');
    expect(from, 'the corrections line is missing').toBeGreaterThan(-1);
    const line = note.slice(from, note.indexOf('**Ruled at fix round 1**', from));
    for (const slug of CORRECTION_SLUGS) expect(line, slug).toContain(`\`${slug}\``);
  });
  it('says a forgotten id’s late answer still counts for the box, and no longer says it is dropped', () => {
    expect(note).not.toContain("that call's late answer is dropped.");
    expect(note).toContain("That call's late answer folds nothing for the id, but what it says of the box still counts");
  });
});

// THE RECYCLED ADMIN NAME, THROUGH THE WHOLE VERB (child-workspace reclamation wave 7, spec 2026-09-22 §5.10). After
// the move, a linked worktree inside the leaf still names its admin directory, whose `gitdir` back-link spells the
// PRE-move path, so the removal helper would refuse the leaf's own tree in the slot. The collector passes an ALIAS —
// the pre-move path and the admin=back-link pairs its pre-move ask accepted, from the record — under which such a
// back-link counts as the leaf's own ONLY when (1) the pre-move ask in this lock accepted that same admin directory
// with that same back-link, and (2) nothing stands at the pre-move spelling now. Measured at the wave's pre-flight:
// without both, a recycled admin name passes, and a moved foreign worktree's uncommitted work is deleted. Here git
// prunes and recycles the admin name for real, inside the gaps, and the verb must refuse — kept, never removed.
// And its mirror, a leak rather than a loss: a clone and its own linked worktree, BOTH inside the leaf. git spells
// that worktree's admin directory ABSOLUTELY, by the leaf's pre-move path, so after the move the alias reads that
// spelling at the leaf's new place — while nothing stands at it — and the leaf is collected whole.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`): every repository is under the harness's HOME. Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectVerb, devinoOf, docOf, g2Row, g2Spawn, gapAt, gapErrorsOf, orphanLeaf,
  quarantineOf, recordsOf, slotsOf, tokenOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-admin-'); });
afterEach(() => { h.cleanup(); });

/** The one slot's leaf, after a refusal kept it. */
const keptLeaf = (): string => {
  const slots = slotsOf(h);
  expect(slots, 'one slot is kept').toHaveLength(1);
  expect(recordsOf(h), 'with its record').toEqual([slots[0]!.slice('slot.'.length)]);
  return path.join(quarantineOf(h), slots[0]!, 'leaf');
};

describe.skipIf(!LINUX || !NO_COPY)('the checkout question across the move', () => {
  it('the CONTROL: the leaf\'s OWN linked worktree goes with it — the alias is passed, and both conditions hold', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/g1', path.join(o.leaf, 'wt'));
    const r = collectVerb(h, tokenOf(h), COL_ID);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(devinoOf(o.leaf)).toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
  }, 240_000);

  it('the MEASURED case: a foreign worktree with uncommitted work moved in after the pre-move ask, its admin name pruned and recycled at the pre-move spelling — refused, KEPT (condition 1)', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    const xwt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.mkdirSync(path.dirname(xwt), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/x', xwt);
    fs.writeFileSync(path.join(xwt, 'precious.txt'), 'uncommitted work of another session\n');
    const admin = h.git(xwt, 'rev-parse', '--absolute-git-dir');
    // `slotted`: after the pre-move ask, the session's tree is moved INTO the leaf, and git prunes its record.
    const moveIn = `mv -T -- "${xwt}" "${o.leaf}/still-harbor" && git -C "${main}" worktree prune`;
    // `proven`: the recycled slug's child re-takes the admin NAME at the pre-move spelling, then drops its own tree,
    // so condition (2) holds and (1) alone must refuse.
    const recycle = `${g2Row()} && ${g2Spawn(COL_ID, '')} && git -C "${main}" worktree add -q -b ws/g2 "${o.leaf}/still-harbor"`
      + ` && rm -rf -- "${o.leaf}/still-harbor"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ slotted: moveIn, proven: recycle }));
    expect(gapErrorsOf(h), 'the CONTROL: both injections ran').toEqual([]);
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(),
      'the CONTROL: the admin name was recycled, its back-link the pre-move spelling').toBe(`${o.leaf}/still-harbor/.git`);
    expect(fs.existsSync(path.join(o.leaf, 'still-harbor')), 'the CONTROL: nothing stands at the pre-move spelling').toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)['collected'], r.stdout).toBeUndefined();
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    expect(devinoOf(keptLeaf()), 'the leaf kept in its slot is the witnessed one, by inode').toBe(o.devino);
    expect(fs.readFileSync(path.join(keptLeaf(), 'still-harbor', 'precious.txt'), 'utf8'),
      'the session\'s uncommitted work survives').toBe('uncommitted work of another session\n');
  }, 240_000);

  it('the leaf\'s OWN worktree, its admin name re-taken by a recycled spawn at the pre-move spelling with the SAME back-link — refused, KEPT (condition 2)', () => {
    const o = orphanLeaf(h);
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/g1', path.join(o.leaf, 'wt'));
    fs.writeFileSync(path.join(o.leaf, 'wt', 'g1.txt'), 'the dead child\'s own scratch\n');
    const admin = h.git(path.join(o.leaf, 'wt'), 'rev-parse', '--absolute-git-dir');
    const recycle = `git -C "${main}" worktree prune && ${g2Row()} && ${g2Spawn(COL_ID, '')}`
      + ` && git -C "${main}" worktree add -q -b ws/g2 "${o.leaf}/wt"`;
    const r = collectVerb(h, tokenOf(h), COL_ID, gapAt({ proven: recycle }));
    expect(gapErrorsOf(h), 'the CONTROL: the recycle ran').toEqual([]);
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(),
      'the CONTROL: the same admin directory and back-link the pre-move ask accepted').toBe(`${o.leaf}/wt/.git`);
    expect(fs.existsSync(path.join(o.leaf, 'wt', '.git')), 'the CONTROL: the recycled tree stands at the pre-move spelling').toBe(true);
    expect(docOf(r.stdout)['refused'], r.stdout).toBe('quarantine-kept');
    expect(devinoOf(keptLeaf()), 'the leaf kept in its slot is the witnessed one, by inode').toBe(o.devino);
    expect(fs.readFileSync(path.join(keptLeaf(), 'wt', 'g1.txt'), 'utf8'), 'the kept tree is whole').toBe('the dead child\'s own scratch\n');
    expect(fs.existsSync(path.join(o.leaf, 'wt', '.git')), 'and the recycled tree is untouched').toBe(true);
  }, 240_000);

  it('a CLONE and its own linked worktree, BOTH inside the leaf — git spells the admin directory ABSOLUTELY, by the pre-move path — collected', () => {
    const o = orphanLeaf(h);
    const origin = h.makeRepo('demo2');
    const repo = path.join(o.leaf, 'repo');
    h.git(h.home, 'clone', '-q', origin, repo);
    h.git(repo, 'worktree', 'add', '-q', '-b', 'ws/g1', path.join(o.leaf, 'wt'));
    expect(fs.readFileSync(path.join(o.leaf, 'wt', '.git'), 'utf8').trim(),
      'the CONTROL: the worktree names its admin directory absolutely, under the leaf\'s pre-move path')
      .toBe(`gitdir: ${fs.realpathSync(path.join(repo, '.git', 'worktrees', 'wt'))}`);
    const r = collectVerb(h, tokenOf(h), COL_ID);
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(devinoOf(o.leaf), 'the leaf went, the clone and its worktree with it').toBeNull();
    expect(slotsOf(h)).toEqual([]);
    expect(recordsOf(h)).toEqual([]);
    expect(fs.existsSync(path.join(origin, 'README.md')), 'the clone\'s origin, outside the leaf, is untouched').toBe(true);
  }, 240_000);
});

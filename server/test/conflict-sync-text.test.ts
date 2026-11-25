// One spelling of the conflict-sync mail in four files (landing-order wave 1c;
// spec 2026-09-23 §5.1 and §11 item 23; D-9011, D-9012, D-9013).
//
// Worker clause 16's fourth trigger is stated in four places: the clause
// itself, the session hook's landing advisory (the only text a session that
// loads no ccrc skill sees), the coordinator's run-care reference (the sender's
// procedure) and the README. A worker matches the mail by its subject word, so
// the four must spell it the same, and each that states the bound must bound it
// to the one named commit: a newer `main` is not the named commit.
//
// Each file is read as text from the repository root, as `worker-skill.test.ts`
// reads the skill, and its whitespace is flattened to single spaces first:
// the README and the reference wrap their prose, so a phrase may cross a line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string =>
  readFileSync(path.join(root, rel), 'utf8').replace(/\s+/g, ' ');

const worker = read('ccd/worker-skill/SKILL.md');
const hook = read('ccd/session-hook.sh');
const runCare = read('ccd/coordinator-skill/references/wave-lifecycle-run-care.md');
const readme = read('README.md');

// Boolean checks with a short message, never `toContain` on the file: on a
// miss vitest diffs the whole text, and a flattened README of several hundred
// kilobytes held one measured run past ten minutes before it printed.
const has = (name: string, text: string, needle: string): void => {
  expect(text.includes(needle), `${name} lacks: ${needle}`).toBe(true);
};

const files: ReadonlyArray<readonly [string, string]> = [
  ['ccd/worker-skill/SKILL.md', worker],
  ['ccd/session-hook.sh', hook],
  ['ccd/coordinator-skill/references/wave-lifecycle-run-care.md', runCare],
  ['README.md', readme],
];

describe('the conflict-sync mail: one spelling in four files (landing-order wave 1c)', () => {
  it('spells the subject word the same in the worker clause, the hook advisory, the coordinator reference and the README', () => {
    // The hook writes the word inside a double-quoted bash string, so its
    // backticks are escaped there; the advisory it prints carries them bare
    // (`session-hook-sync-advisory.test.ts` holds the printed text).
    for (const [name, text] of files) has(name, text.replace(/\\`/g, '`'), '`conflict-sync:`');
    for (const [name, text] of files) {
      const stray = text.match(/conflict[ _]sync:|Conflict-sync:|conflictsync/);
      expect(stray?.[0] ?? null, `${name} misspells the subject word`).toBeNull();
    }
    // The word anywhere in a file is not the subject: the sender's own example
    // must open its subject with the exact word (review 3727 A2).
    has('wave-lifecycle-run-care.md', runCare, 'subject `conflict-sync: #<pr>`');
    has('wave-lifecycle-run-care.md', runCare, '"subject":"conflict-sync: #<pr>"');
  });

  it('bounds the fourth trigger to the named commit in every file that states it', () => {
    has('ccd/worker-skill/SKILL.md', worker, 'one absorption of exactly the named commit per mail');
    has('ccd/session-hook.sh', hook, 'absorb exactly that commit, once per mail');
    has('README.md', readme, 'one absorption of exactly the named commit per mail');
    expect(/One mail per measured conflict/.test(runCare), 'run care lacks: One mail per measured conflict').toBe(true);
    // The reference's own bound, not only its lead-in (review 3727 F2).
    has('wave-lifecycle-run-care.md', runCare, 'absorbs exactly that commit, once, with `git merge`');
    has('wave-lifecycle-run-care.md', runCare, 'A newer `main` is not the named commit');
  });

  it('closes the fourth trigger at the wave-done in the hook and the README too, not only in the clause (review 3727 F3)', () => {
    // The limit keeps trigger 3's edge the only route from `merging`, and the
    // hook is the only text a session without the skill sees. The words say
    // THIS ROUND's wave-done: a worker sent back for a fix round has sent one
    // already, and the fix round is the case this trigger exists for, so the
    // receiver's words follow the sender's (review 3738 F3, ruled).
    has('ccd/worker-skill/SKILL.md', worker, "before this round's wave-done only");
    has('ccd/session-hook.sh', hook, "before this round's wave-done only");
    has('README.md', readme, "before the worker's wave-done of that round only");
    // The sender's procedure states the same ruling, by the run's state
    // (review 3738 F4), and names each state's own route (review 3738 F2).
    has('wave-lifecycle-run-care.md', runCare,
      "A worker sent back to `working` for a fix round is before its wave-done until it sends that round's fresh one");
    has('wave-lifecycle-run-care.md', runCare,
      'never at `awaiting-review`, where the route is a send-back with a report, nor at `merging`, where the route is the ejection that names a base');
  });

  it('makes the worker\'s own probe the licence in the hook and the README, not only in the clause (review 3738 F5)', () => {
    // Without the probe the mail reads as an instruction; with it, as a licence.
    has('ccd/worker-skill/SKILL.md', worker, 'and your own probe of that commit, `git merge-tree --write-tree --name-only --no-messages HEAD <base>`, exits 1 with a tree id on its first line');
    has('ccd/session-hook.sh', hook, 'and your own probe of that commit agrees');
    has('README.md', readme, "and the worker's own probe of that commit agrees");
  });

  it('gives the mail the same two body entries where its form is stated', () => {
    has('wave-lifecycle-run-care.md', runCare, '`base: <sha>`');
    has('wave-lifecycle-run-care.md', runCare, '`paths: <the conflicted paths>`');
    // The base is a COMMIT, read by rev-parse beside the probe: the probe prints
    // a tree id, and a tree id in `base:` leaves the worker's own probe
    // unmeasured, so the trigger would license nothing (review 3727 F1).
    has('wave-lifecycle-run-care.md', runCare, 'git rev-parse origin/main');
    // The shell block itself, not only the prose that names it: the probe's
    // last line and the rev-parse line are neighbours inside the fence
    // (review 3738 F1). Flattened, the fence's close follows the rev-parse.
    has('wave-lifecycle-run-care.md', runCare, '<the branch tip> origin/main git rev-parse origin/main ```');
    has('wave-lifecycle-run-care.md', runCare, 'copied from the rev-parse output and never typed');
  });
});

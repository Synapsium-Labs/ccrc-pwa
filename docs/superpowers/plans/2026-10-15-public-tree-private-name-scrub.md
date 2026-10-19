# Public tree private-name scrub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every private name from the current tree of this public repository, and add a ratchet class that
stops a listed name from coming back, in one PR.

**Architecture:** One line-neutral sweep of the tree on `main`, file group by file group, driven by a local list
that never enters the repository, plus a hashed class in `server/test/topology-clean.test.ts`. The class compares
salted hashes of the tree's tokens with committed entry hashes. The hashes stop casual grepping and indexing; they
do not keep a name secret, because the salt is committed and anyone can confirm a guess. So only names already
public in this repository's history are committed as hashes; a name that was never published stays in the local
list alone. The class lands red-first, the sweep turns it green, and the two old literal-list classes it replaces
are removed. History, release tarballs, forks and old PR revisions are out of reach of a tree change: they are the
operator's, under "Not in this plan".

**Tech Stack:** Node 22 (`node:crypto` HMAC-SHA256, `String.prototype.normalize`), vitest, bash, git plumbing reads.

**Spec:** none. The authority is the operator's public-repos rule (2026-10-12) and the operator's ruling of
2026-10-15 ordering this clean-up. This plan carries its own decisions (below), as the ratchet's header asks ("any
future exception must be argued into this file").

## Global Constraints

- **Nothing private is written anywhere public**: no listed token in any file, commit message, branch name, PR
  title, PR body or review comment, at any commit of the branch. The branch name is neutral (the workspace's own
  `ws/<adjective>-<noun>`). Every commit message is the fixed message its task gives. The PR title is
  `chore: neutral fixture and record vocabulary (line-neutral)`; the body names no token and no reworded line.
- **The list is local.** It lives at `$(git rev-parse --git-common-dir)/info/ccrc-private-names` (mode 0600, one
  file for every worktree of the clone), with the read-only inventory beside it in `info/ccrc-scrub/`. Its columns
  are `mode`, `token`, `stand-in`, `class`, `visibility` (`pub`, `local` or `measure`). Never copy either into the
  tree, a commit, a mail body, a PR or a log. Never print a matched token: every tool in this plan prints
  `path:line #<h8>`, where `h8` is the first 8 hex of the entry's hash.
- **Before every push**, run `grep -i -F -f <(cut -f2 <list> | grep -v '^#')` over the branch name, `git log
  --format=%B <base>..HEAD`, and the PR title and body you are about to save; it must print nothing.
- **Line-neutral.** Every edit replaces text inside a line. No line is added or removed in any file this plan
  sweeps, so every `file:line` citation, every plan anchor and the S6-R11 citation census stay where they are.
  Never reflow a paragraph. `git diff --numstat` shows equal added and removed counts for every swept file.
- **No new `D-<n>` token** except a number issued to this run. A number written in prose raises the ledger floor.
- **`ccd/ccd` is generated.** Edit it last, then re-stamp with the shipped `markGenerated`: `HOME=$(mktemp -d) bash
  ccd/ccrc restamp ccd/ccd` (a file transform; the throwaway HOME keeps the fixture-HOME rule), never by hand.
  `ownership.test.ts` must read `ccrc-unmodified`.
- **Stand-ins** come from the list's third column. A test that depends on sort order, length, prefix relation or
  case pairing gets a per-file variant that keeps the property; record every variant in `info/ccrc-scrub/
  variants.tsv` (local: path, entry `h8`, stand-in, property kept). A lane stand-in matches the roster grammar
  `^[a-z][a-z0-9-]{0,31}$` and is never a `DEFAULT_TEST_ROSTER` id (`claude`, `claude-a`, `claude-b`, `claude-d`,
  `gpt`), which would change longest-prefix resolution. A project stand-in is `project-<letter>` from the letters
  unused in the tree (`project-a` and `project-b` are already fixtures). A made-up repo slug is
  `example-org/example-repo`, never one under the repository's own org.
- **Not private, never swept:** ccrc's own components (`ccrc`, `ccd`, `ccgpt*`, `ccrc-codex*`), the public org that
  owns this repo, `gpt` and `claude` as roster words, DuckDNS and the cloud-provider reboot API as product
  features, provider and model names, the generic words "docserver" and "docs server", documentation placeholders
  already in use, and the public open-source upstream the history programme cites (Task 1 Step 6).
- **Fixture HOMEs only**; never run `ccd`, `ccrc` or a hook against the live `$HOME`.
- **Suites** run from inside each package with `./node_modules/.bin/vitest run <file>`, in the foreground, with a
  timeout of at least 600000 ms. Push only after Task 7 is green.

## Review Focus

1. **A test that stops testing its premise after a swap.** Sort order (an upper-case project name sorting before a
   lower-case one; an id that must sort after `claude-`), equal lengths (two lane ids that tie), a strict prefix, a
   29-character id stated on four lines, case pairs (`X` and its derived lower-case handle `x-42`), `LC_ALL=C`
   byte order. Each such file keeps the property with a recorded variant, and its suite counts match before and
   after.
2. **A line that moved.** Any added or removed line shifts the census, plan anchors and `D-<n>` cross-references.
3. **A guard that leaks.** Class 9's output, `catches`, `passes`, test titles and failure messages never contain a
   real token. CI logs on a public repository are public.
4. **A gap that reads as green.** A tokenizer gap (a compound id, a camelCase identifier, a split or encoded form)
   leaves a hit that class 9 and the scan both miss. The independent `grep -F` cross-check is the gate, not the
   matcher alone.
5. **A merge that breaks the digest.** Whichever of this PR and another `ccd/ccd` PR lands second merges `main`,
   keeps both bodies and re-stamps.

---

## Decisions

| # | Decision | Default (the operator may overrule at review) |
|---|---|---|
| 1 | Scope | The tree at the branch point, every tracked file, frozen docs included. Not history, release assets, the fork or old PR revisions |
| 2 | Regrowth guard | Class 9 in `topology-clean.test.ts`, hashed entries for names already public in history; the local list holds every name and feeds the local scan and the pre-push hook |
| 3 | The base64 literal lists in `topology-clean.test.ts` and `license.test.ts` | Every decoded literal is a list entry (already appended locally). The two classes made only of literals ("fleet account label", "operator residue") are removed; "tailnet name" keeps its `.ts.net` shape and synthetic catches; the registration pin becomes 7 (8 - 2 + 1). `license.test.ts`'s old-org check becomes a class 9 lookup that prints `#h8` |
| 4 | Issue-tracker ticket ids | Each becomes the GitHub `#n` it is mirrored as (the list gives every mapping) |
| 5 | Real person names | Roles: "the operator", "a colleague" |
| 6 | Commercial and legal passages | Reworded in place to say a decision exists, without its content; the operator reads each one from a local list the wave-done mail points at |
| 7 | Provider and model names | Kept (public product names); only the lane ids are swept |
| 8 | Session UUIDs in docs | Kept (not in the rule; the session-id class covers the URL shape) |
| 9 | A generic word that is also a private short name (the tracker team's product word, an employer short form, a platform stem) | Swept only where it names the private thing; judged per hit, each judgement recorded in `variants.tsv` |
| 10 | `/home/<x>` fixture homes that echo a box role | Swapped to `/home/u`, the producer and the expectation together in each file |
| 11 | History rewrite | Not done ("Not in this plan") |

---

## File Structure

- Create `server/test/private-names.mjs`: the one tokenizer, matcher and hasher (a test helper; not shipped, so an
  edit does not force CI's full suite). Exports `PRIVATE_NAME_SALT`, `tokens(line)`, `hashEntry(text)`,
  `matchLine(line, entries)`. CLI: `hash --list <path>` (prints the `PRIVATE_NAMES` literal for the list's `pub`
  rows, sorted by hash) and `scan --list <path>` (prints `path:line #h8` for every tracked text file, every row).
- Create `server/test/private-names.test.ts`: unit pins, synthetic tokens only.
- Modify `server/test/topology-clean.test.ts`: class 9; remove two classes; the net-diff range corpus.
- Modify `server/test/license.test.ts` (Decision 3) and `server/test/coordinator-skill.test.ts` (Task 3).
- Modify, line-neutrally: the files the scan lists (about 290 at `518789ad0`): about 140 frozen docs, about 120
  tests, about 31 shipped files (comments only), `README.md`.

---

### Task 1: The matcher and class 9, red-first

**Files:**
- Create: `server/test/private-names.mjs`, `server/test/private-names.test.ts`
- Modify: `server/test/topology-clean.test.ts`, `server/test/license.test.ts`

**Interfaces:**
- Produces: `tokens(line: string): {t: string, start: number, joinerBefore: '' | '-' | '.' | '_' | '·' | 'case' |
  'space' | 'other'}[]`; `hashEntry(text: string): string` (32 lower-case hex); `type Entry = {h: string, f:
  string, n: number, mode: 'part'|'run'|'words'}` (`f` the first token's hash, `n` the token count);
  `matchLine(line: string, entries: Entry[]): string[]` (the `h8` of every matched entry, never text).

- [ ] **Step 1: Preflight.** `test -r "$(git rev-parse --git-common-dir)/info/ccrc-private-names"`. If it fails,
  stop and ask the coordinator. Never copy the list.

- [ ] **Step 2: Write the failing unit pins** (synthetic tokens only):

```ts
import { hashEntry, matchLine, tokens } from './private-names.mjs';
const e = (text: string, mode: 'part'|'run'|'words') => {
  const ts = tokens(text).map((x) => x.t);
  return { h: hashEntry(ts.join('-')), f: hashEntry(ts[0]!), n: ts.length, mode };
};
const h8 = (x: { h: string }) => x.h.slice(0, 8);

it('part matches a token or a window of a run, case-blind, across - . _ and middle dot', () => {
  const a = e('zz-alpha', 'part');
  for (const s of ['see zz-alpha-quiet-mesa', 'ZZ-Alpha', 'zz_alpha', 'zz.alpha', 'zz·alpha'])
    expect(matchLine(s, [a])).toEqual([h8(a)]);
  expect(matchLine('zz-alphabet', [a])).toEqual([]);
});
it('part splits camelCase, so an identifier built on the token is caught', () => {
  const b = e('zz9', 'part');
  expect(matchLine('const zz9Row = 1', [b])).toEqual([h8(b)]);
});
it('run matches only a whole run', () => {
  const c = e('zz-beta', 'run');
  expect(matchLine('host zz-beta.', [c])).toEqual([h8(c)]);
  expect(matchLine('zz-beta-hierarchy-design.md', [c])).toEqual([]);
});
it('words matches a phrase across any whitespace', () => {
  const d = e('zed quux', 'words');
  expect(matchLine('by Zed\n  Quux today', [d])).toEqual([h8(d)]);
});
it('never returns text', () => {
  expect(JSON.stringify(matchLine('zz-alpha', [e('zz-alpha', 'part')]))).not.toMatch(/alpha/i);
});
```

- [ ] **Step 3: Run them and see them fail.** `cd server && ./node_modules/.bin/vitest run
  test/private-names.test.ts`. Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write the module, two-stage.** `tokens`: NFKC-normalise, split on lower-to-upper camelCase
  boundaries, then lower-case; tokens are maximal `[a-z0-9]+`; record each token's joiner. Hash each UNIQUE token
  once per process (a `Map`; the tree has about 80k unique tokens). A window is built only at a token whose hash
  is some entry's `f`, and only for the token counts entries starting there actually have; it is hashed as its
  tokens joined by `-`. `part` and `run` windows join across `-`, `.`, `_`, `·` and camelCase; `run` also needs no
  such joiner before its first token or after its last; `words` windows join across whitespace only.
  `hashEntry(text)` is `createHmac('sha256', PRIVATE_NAME_SALT).update(text).digest('hex').slice(0, 32)`.
  Measure the whole-tree scan and pin the measured time in a comment; it must stay well under vitest's 20 s test
  timeout on the CI runner.

- [ ] **Step 5: Run the unit pins green.**

- [ ] **Step 6: Classify every list row `pub` or `local`.** For each `measure` row, measure whether the token
  occurs anywhere in this repository's public history (`git log --all -i -G` with the token as a fixed string, or
  an equivalent), printing only the row number and a count. Present in history means `pub`: hashing it reveals
  nothing new. Absent means `local`. Rows already marked `local` stay local. Update the local list in place.

- [ ] **Step 7: Add class 9, red.** `ForbiddenClass` gets an optional `match(line): string[]`; exactly one of
  `pattern` and `match` is set, and `scoresOn`, `violationsOf` and the liveness row branch on it. `PRIVATE_NAMES`
  is the literal `hash --list` prints: a canary entry first (a synthetic token, `CANARY`), then the `pub` rows
  sorted by hash. Class 9 also reads `SELF` (its entries are hashes), exempting only the line that defines
  `CANARY` by its line digest. Its exemptions are argued once beside the class: a hit followed by `@` and seven or
  more hex digits, or inside the history programme's named upstream-plugin phrase, in a document whose path
  contains `ccrc-history`; a pin keeps the exemption list at most three entries.

```ts
{
  name: 'private name (hashed)',
  why: 'the operator rule of 2026-10-12: no other project, lane, host, person, ticket or commercial matter in this ' +
    'public tree; speak in project-<x>, claude-<x>, the fleet box, <projects-root>',
  match: (line) => matchLine(line, PRIVATE_NAMES),
  catches: [CANARY],
  passes: ['ccrc', 'ccd', 'ccgpt', 'ccrc-codex', 'gpt', 'claude', 'claude-a', 'project-a',
    'example-org/example-repo', /* one product run per run-mode entry: a product doc name containing it */],
}
```

  The liveness row for class 9 expects exactly `server/synthetic.md:1 #<canary h8>`, and asserts the joined output
  does not contain `CANARY`: that is the leak pin.

- [ ] **Step 8: Remove the literal classes (Decision 3).** Delete the "fleet account label" and "operator residue"
  classes and their constants; strip the tailnet class to its `.ts.net` shape and its synthetic catches; delete
  every private token from `SELF`'s `passes` lists. Set the registration pin and its title to 7. In
  `license.test.ts`, replace the old-org constant with a class 9 lookup whose failure message is `#h8`. Run the
  scan over each removed literal's row (a local probe, nothing committed): each one is a class 9 hit.

- [ ] **Step 9: The range corpus.** For class 9 only, the branch row reads the NET added lines of the branch,
  `git -c color.ui=never diff --no-ext-diff --no-textconv <merge-base>...HEAD` (the `+` lines, keyed on each
  `+++ b/<path>` header, skipping `SELF` and binary paths), with the same git-config isolation the existing range
  row uses. An open branch is then charged only for what its tip adds, and clears by editing its tip. Commit
  messages and branch names are not class 9 corpora; the pre-push hook and the push check above cover them. Add a
  fixture-repo row: a throwaway repo whose middle commit adds `CANARY` to a file and whose last commit removes it
  reads clean; one whose tip still adds it reads exactly one `#<canary h8>`; a `SELF` path addition reads none.

- [ ] **Step 10: Record the red, and cross-check it independently.** Run `topology-clean`: class 9's tree row is
  red with the work-list, its liveness, catches and passes rows are green, every other class is green. Run
  `scan --list` and save its output to `info/ccrc-scrub/baseline.txt`. Then reconcile it against two independent
  readers: `git ls-files -z | xargs -0 grep -n -i -I -F -f <(tokens of the list)` (case-blind substrings), and the
  inventory's `info/ccrc-scrub/lines.txt`. Every line one lists and the scan does not is either a list gap (add a
  row) or argued not private in `variants.tsv`. Also grep the tree for the base64 encoding of every row.

- [ ] **Step 11: Commit** `test(topology): hashed vocabulary class (red until the sweep)`.

### Task 2: Frozen documents

**Files:** `docs/superpowers/{specs,plans,research,programs}/**`, `.superpowers/sdd/**`, as the scan lists them.

- [ ] **Step 1: Claims.** Read `GET /api/claims?project=ccrc-pwa` and list every scanned file a live claim holds.
  A claimed file waits for its holder's consent or release (agree the scope by the peer protocol); do the rest
  first. Repeat before Tasks 4, 5 and 6.
- [ ] **Step 2:** Replace each hit in place with its stand-in; ticket ids by Decision 4, person names by Decision 5,
  the munged volume path as one unit, any base64 copy of a listed literal by a placeholder.
- [ ] **Step 3: Commercial and legal passages (Decision 6).** The work list is `info/ccrc-scrub/crit-text.txt`
  (local). Reword in place, one line for one line. Write the reworded `path:line` list to
  `info/ccrc-scrub/operator-read.txt` (local); the wave-done mail names that path, never the lines.
- [ ] **Step 4:** The two citation-corpus documents of the compaction card (the 2026-09-09 spec and 2026-09-10
  plan) are swept like the rest, and `session-hook.test.ts`'s citation describes stay green unchanged.
- [ ] **Step 5:** `git diff --numstat` shows equal counts for every file; the scan lists no frozen document.
- [ ] **Step 6: Commit** `docs: neutral stand-ins in historical records (line-neutral)`.

### Task 3: The pinned crossrepo specification

**Files:** `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`, its restatements (the crossrepo
ledger, the 2026-09-08 spec and the wave-3 docs-flip plan), `server/test/coordinator-skill.test.ts`

- [ ] **Step 1:** Sweep the spec and its three restatements identically, so the concept regexes that read them
  still match (the stand-ins are shorter, so their bounded windows only narrow).
- [ ] **Step 2:** The byte-identity pin compares the file with `origin/main`, so it is red on this branch. Amend it
  in the same commit so it still refuses an edit after this PR lands (for example a pinned digest of the swept
  bytes beside its content literals). Record the change as a departure.
- [ ] **Step 3:** Run `coordinator-skill.test.ts` and `crossrepo-prose.test.ts` alone, green.
- [ ] **Step 4: Commit** `docs: neutral stand-ins in the crossrepo record; its byte pin re-based (line-neutral)`.

### Task 4: PWA tests

**Files:** `pwa/test/rosterFixture.ts` and every PWA test the scan lists.

- [ ] **Step 1:** Run the PWA suite at the base and record the counts.
- [ ] **Step 2:** Change the roster fixture and every importer in one commit. Keep: `claude` a strict prefix, the
  id that must sort after `claude-`, the two ids that tie in length, the upper-case-first project that sorts
  before a lower-case one, derived lower-case handles that follow their project, case variants of an id inside
  identifiers and labels.
- [ ] **Step 3:** Run every touched file alone, then the package suite: the same counts as Step 1.
- [ ] **Step 4: Commit** `test(pwa): neutral roster and project fixture ids (line-neutral)`.

### Task 5: Server and agent tests

- [ ] **Step 1:** As Task 4, file by file, for `server/test/**` and `agent/test/**`. Mind the files that reason
  about `LC_ALL=C` byte order, the derived memory filenames, the prefix-resolution fixtures, the case variants
  (an upper-case constant, a `Row` identifier, a capitalised label), and the one split account label that no token
  form can match (hand-swept; recorded in `variants.tsv`).
- [ ] **Step 2:** Run every touched file alone, then each package suite; re-run the CLAUDE.md load flakes alone
  before calling a red real.
- [ ] **Step 3: Commit** per package: `test(server): neutral fixture ids (line-neutral)`, `test(agent): neutral
  fixture ids (line-neutral)`.

### Task 6: Shipped comments, README and CLAUDE.md

**Files:** comment lines in `ccd/*`, `shared/*`, `server/src/*`, `pwa/src/*`, `pwa/design/*`; `README.md`;
`CLAUDE.md` where the scan lists it.

- [ ] **Step 1:** Comments only; no identifier, value or default changes (the inventory found none needed). The
  one commercial passage in a shipped comment is reworded by Decision 6. In the four `single-definition` roots, no
  comment may quote two test-roster ids inside one `[...]`.
- [ ] **Step 2:** The 29-character id: every line that states that length (four at `518789ad0`, README included)
  takes one 29-character variant, the same on each.
- [ ] **Step 3:** `ccd/ccd` last; re-stamp; `ownership.test.ts` green; `session-hook.test.ts` green with the census
  figures unchanged.
- [ ] **Step 4: Commit** `chore: neutral stand-ins in comments and docs (line-neutral)`.

### Task 7: Green, and the record

- [ ] **Step 1:** `topology-clean` green. `scan --list` prints nothing. The independent `grep -F` cross-check of
  Task 1 Step 10 prints nothing that `variants.tsv` does not argue.
- [ ] **Step 2: Mutants.** Drop class 9's `match` (the canary liveness row reds); print the line instead of `#h8`
  (the leak pin reds); widen a `run` entry to `part` (its product run in `passes` reds); drop `·` from the joiners
  (a unit pin reds); charge per-commit instead of net added lines (the fixture-repo row reds).
- [ ] **Step 3:** Every touched suite alone, then the packages; `git fetch origin main`, then `deviation-refs`.
- [ ] **Step 4:** The PR body: counts per file group, the departures, and "Not in this plan". The push check of
  Global Constraints passes.

---

## Not in this plan (the operator's)

- **History.** Every earlier commit, blob and commit message keeps the old text. A rewrite changes every SHA the
  fleet's run records, plans and release provenance cite, cannot reach `refs/pull/*`, the fork or existing clones,
  and needs a GitHub support request to purge cached views. Default: no rewrite.
- **This PR's own diff.** GitHub shows every removed line in the PR's diff, so the PR is an index of the old text
  beside its stand-in. The same text is already public at every earlier tag; weigh it before the PR opens.
- **Release tarballs.** Each release ships its tag's tree. Deleting or rebuilding them breaks `ccrc update` and
  `ccrc rollback --to <tag>` and the "stable is a promotion, never a rebuild" rule. Default: keep them; releases
  are clean from this PR's merge on.
- **Edited PR descriptions and live PR text.** GitHub keeps every revision of an edited description; removing one
  is a manual step in the GitHub UI. A few live PR titles and bodies carry a ticket id (Decision 4); patching them
  is a coordinator act after the ruling.
- **Remote branch names.** One remote branch name carries a ticket id; deleting it is its owner's act once its PR
  closes.
- **The pre-push hook.** Untracked plumbing in the clone's common directory. Its next version reads the local list
  and checks added lines, commit messages and ref names; a coordinator act after this PR merges.
- **Open branches.** After the merge, class 9 charges an open branch only for its net added lines; each owner
  sweeps its own tip on the next merge of `main`.

## Deviations found

Run 561 was issued D-5277 to D-5288 at dispatch. Each number is defined here when it is taken.

- **D-5277** — `visibility-measured-by-token` (Task 1 Step 6): a row's visibility was measured with the class's own
  tokenizer, as a whole token joined any way (every form a row commits, matched as `part`), over the messages and
  patches reachable from `origin`'s branches and the tags that exist on `origin`, not with `git log --all -i -G`.
  `--all` reaches refs that were never published (local-only tags, the stash), and a fixed-string `-G` counts a token
  inside an unrelated longer word, which would commit a hash for a name whose private sense was never public. A row
  whose base64 copy is in that history counts as present: the two base64-literal classes this plan removes published
  those names in decodable form, so hashing them reveals nothing new. Result: 80 rows `pub`, 17 `local`: 9 measured absent, and 8 the list already marked `local`, which stay
  local by Step 6's rule whatever history holds (one of them is in a commit trailer); no `local` row has a hit in the
  tree. A first pass that matched each row in its own mode
  marked one row `local` that the tree speaks joined another way; the Task 1 review found it.
- **D-5278** — `no-product-passes` (Task 1 Step 7): class 9's `passes` carry no product run. The tree speaks product
  vocabulary containing a `run` entry's tokens for one row only, and committing that vocabulary beside the class,
  with or without a comment, tells a reader which tokens that entry is made of. The `run`/`part` distinction is
  pinned by synthetic unit pins in `private-names.test.ts` instead, and the Task 7 mutant that widens a `run` entry to
  `part` shows red on the tree row. The passes are ccrc's own vocabulary, the house stand-ins, and the replacement
  vocabulary the two removed classes pinned.
- **D-5279** — `entries-live-in-the-matcher` (Task 1 Steps 7-8): `PRIVATE_NAMES`, `CANARY` and `EXEMPTIONS` are exported
  by `private-names.mjs`, not defined in `topology-clean.test.ts`: `license.test.ts` reads the old-org entries from
  them (Decision 3) and the local scan applies the same exemptions as the class, so both need one copy. `CANARY` is
  built by `join`, so no line of the tree spells it as one run, and the planned line-digest exemption for its
  defining line is not needed. A `match` class takes `(line, file)`. Both exemptions apply to one entry only, in
  documents under `docs/` whose path names the history programme.
- **D-5280** — `every-form-of-a-name` (Task 1 Step 10, Review Focus 4): the tokenizer and the entries cover the forms the
  tree writes a name in, found by the independent `grep -F` cross-check and by the Task 1 review. A list row commits
  up to three entries (`entriesOf`): its tokens split at camelCase boundaries, its camelCase pieces merged, and all
  its tokens run together. A line is read split; then, where it has a camelCase boundary, every run of two to four
  consecutive camelCase pieces, at most 40 characters, is read as one token against the one-token `part` entries
  (a name inside `useXxx` or `XxxClient`), and its pieces merged. An upper-case run splits before its last capital when a lower-case letter
  follows. A line is folded one code point at a time: NFKC, Unicode hyphens to `-`, soft hyphens and zero-width
  characters dropped. The old classes matched substrings, so a name with a letter or digit appended still scored;
  class 9 matches whole tokens, and such a form is caught only where it is another listed row.
- **D-5281** — `modes-keep-their-joiners` (Task 1 Step 10): `run` matches the joiners its name is listed with
  (case-blind), not any run joiner, and a fourth mode, `exact`, matches anywhere in a run with the listed joiners.
  Measured at the branch point: some rows' tokens also occur in product vocabulary or in fixture file names, joined
  by a different character, and every such hit was a false positive. The local list's modes changed for nine rows:
  one to `exact`, eight from `run` to `part`, where `part` loses nothing and also catches a name inside a branch or
  workspace slug.
- **D-5282** — `the-class-reads-like-the-scan` (Task 1, Review Focus 3 and 4): class 9 prints a path with each hit
  replaced by its `#h8` (overlapping hits masked as one span), since a file named after an entry would otherwise put
  the name into a public CI log, and it reads a `words` phrase broken across two lines (through a repeated comment or
  quote marker), which the plan left to the local scan. The branch corpus reads a
  path git decorates in a diff header (a trailing TAB after a space, C-quoting with octal escapes).
- **D-5283** — `commercial-work-list` (Task 2 Step 3): `info/ccrc-scrub/crit-text.txt` is the inventory critic's list of
  text paths, not the commercial and legal work list. The work list was the critic's commercial entry, re-measured at
  the branch point with a search for commercial and legal phrases. Neighbouring sentences carried the same matter, so
  more lines were reworded than the entry named; each reworded `path:line` is in the local `info/ccrc-scrub/operator-read.txt`, for the operator to read.
- **D-5284** — `byte-pin-is-a-blob-id` (Task 3 Step 2): the 2026-08-11 crossrepo specification's byte-identity pin now
  compares the file's git blob id (`git hash-object --no-filters`) with the id of the swept bytes, beside its four
  content literals, instead of comparing it with `origin/main`. The sweep had to edit the file, and after this lands
  an `origin/main` comparison would compare the file with itself. The blob id needs no new import, so the edit to the
  swept test stays line-neutral. Measured: a one-byte edit to the specification reds the pin.
- **D-5285** — `hand-swept-forms` (Tasks 2-6, Review Focus 4): forms of a private name that no list entry can carry
  without reading neutral vocabulary as private were swept by hand, each recorded in the local `variants.tsv`: a lane's
  bare suffix standing for the lane (the same word is part of the neutral fixture vocabulary), a lane-family suffix or
  a suffix fragment beside a lane stand-in, a name written with a space, URL-encoded or split by a control-byte escape
  (a comment's example then still renders as its stand-in), a name built from string parts, and a `run` name inside a
  hyphen run. Decision 10's `/home/<x>` became `/home/u` in files with no list hit too, the producer and the expectation
  together. The 29-character id (Task 6 Step 2) is `project-h-id-pad-keen-prairie` on all four lines that state the
  length.
- **D-5286** — `a-ledger-sweeps-itself` (Task 2, Task 7 Step 1): `docs/superpowers/programs/path-identity.md` is not
  swept here. By ruling, its programme sweeps it on that programme's own ledger PR, which carries other edits not yet
  published, so this PR carries its 12 hits and class 9's tree row stays red on that file alone until that PR merges.
  The wave-done follows that merge and one merge of `main`. `ccd/ccd` was swept here with that programme's consent:
  comment lines only, then re-stamped.

# Wave 5l, Task 3: the coordinator references (D-9115)

Run 3942, programme `landing-order`, wave 32. Plan section 7, with section 12's C6 (the early sentence stands last in
§5b's opening and begins "Besides the verdict"; "positively opted in" everywhere).

## Base and claims

- Built on `main` at `ad52d25f4b`. The four references and `server/test/coordinator-skill.test.ts` are byte for byte the
  same there as at the plan's baseline `f45fce5aee`, so the old texts of section 7 were found as written, each once.
- Claim 7333 holds the four references, the test file and this note.

## What changed

- `wave-lifecycle-5b-landing.md`: §5b's opening gains its last sentence (7.1); the landing-line paragraph gains six
  sentences after "never choose a successor." (7.2); the stop paragraph names two exceptions, and "only the first
  exception" goes on to the new-head route (7.3).
- `wave-lifecycle-5-boundary.md`: the native-queue paragraph gains one sentence after "is never marked ready." (7.4).
- `wave-lifecycle-4-advance.md`: "Ready, then `merging`" gains one sentence (7.5). Not pinned.
- `wave-lifecycle-2-dispatch.md`: the ready sentence widens (7.6). Not pinned.
- `server/test/coordinator-skill.test.ts`: the intro pin takes the new sentence as its last element; the queue action pin
  takes its new sentence after the refused-advance one; the line pin (`LINE`) takes the six sentences, one element each;
  the stop pin and "says what a stop does" take the two changed sentences.
- No `SKILL.md` clause changes.

## Red first, then green

- The pins were changed before the text, but I did not run the suite between the two edits, so Step 2's red was not
  measured on its own. Mutation row M18 stands in for it: four mutants, each removing one new sentence from its
  reference, measured below.
- After the text: `coordinator-skill` 290 passed, `coordinator-landing-verdict` 762, `coordinator-skill-autonomy` 32,
  `coordinator-approval-prompts` 10, `ccrc-api-closed` 52 (run only), each alone through `ccrc test`.

## Mutation row M18

Each row: the mutant applied in place by a driver under the session's temp root, the named file run once through `ccrc test` (vitest, `--maxWorkers=2`), every listed case red, then the file's original bytes written back and their sha256 checked equal to the committed file's. No mutant survived.

| id | Mutation | File | Run | Red cases (measured) | Restored sha256 |
|---|---|---|---|---|---|
| M18a | §5b opening's new last sentence removed | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | pins the whole opening of §5b, from its heading to the verdict lines (the intro pin) | `a932ead444bb24c218097e2ae1455d6eff3d13b3b9f2b0a25033fbfa8edbd44d` |
| M18b | the line paragraph's sentence "When that first read's `binding` is already `ready`…" removed | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | pins the whole landing-line paragraph, between the boundary paragraph and the admin-merge door paragraph (the line pin) | `a932ead444bb24c218097e2ae1455d6eff3d13b3b9f2b0a25033fbfa8edbd44d` |
| M18c | the stop paragraph's second exception removed | `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | coordinator-skill.test.ts | pins the whole stop paragraph, to the end of §5b: what a stop does and the reasons it names (the stop pin); says what a stop does, and what is not one (spec §5.7.5); wraps §5b from the stop paragraph to its end at 80 columns | `a932ead444bb24c218097e2ae1455d6eff3d13b3b9f2b0a25033fbfa8edbd44d` |
| M18d | the native-queue paragraph's new sentence removed | `ccd/coordinator-skill/references/wave-lifecycle-5-boundary.md` | coordinator-skill.test.ts | pins the whole native-queue landing paragraph, the gate through the enqueue, read-back, disarm and its end, so no exception can sit anywhere in it (the queue action pin) | `80ddc80e14c1059ae729c761887d725caacffa1c62cfe6bdae20a391874abb50` |

M18c also reds the existing 80-column wrap check of the stop paragraph, besides the two pins the plan names.

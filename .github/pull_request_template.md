<!--
Kept SHORT on purpose. The PR descriptions in this repo already carry the
reasoning — a template that asks for a checklist people tick without reading
would compete with that rather than help it. These are the two things a reader
of THIS repo looks for and the two things a first-time contributor cannot know
to include.
-->

## What changed, and why this shape

<!-- Prose, not bullets. If it is a large mechanical sweep, say so here and keep
     the mechanical part in its own commits, separate from the judgement part. -->

## The mutation table

<!-- A guard ships with a test that goes red when the guard is removed — and the
     table is you having actually watched it. Delete the guard, run the suite,
     record what went red:

       remove `foo()`'s early return  →  4 red (bar.test.ts:12,19,  baz.test.ts:31,44)

     No guard in this change? Write "n/a — no new guard" and move on. -->

---

- [ ] Commits are signed off (`git commit -s`) — see [CONTRIBUTING](../CONTRIBUTING.md#sign-your-commits-off-dco)
- [ ] Ran the affected suites from **inside** the package (`./node_modules/.bin/vitest run`, never bare `npx vitest`)

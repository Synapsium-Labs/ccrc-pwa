# W7 C7a note: the departures the census and the pins took (2026-10-27)

Task C7a of `2026-10-27-consolidation-w7-pwa.md` (D-7179). Each departure below is named by its slug, in this note, in
the commit that took it and in the PR body. The coordinator gets numbers for them from the allocator; this note
allocates none.

## slug request-poll-handler

The plan's definition of a request poll is "a `setInterval` call whose enclosing symbol also calls an `api.*`
member". On the base that counts 7, not the plan's 6: `screens/LinearSection.tsx#LinearSection` calls `api.*` and runs
a 30 s clock tick (`setInterval(() => setNow(Date.now()), 30_000)`) in the same component, and item 4 says that tick is
not a request poll. `requestPolls()` therefore reads the interval's HANDLER: the `api.*` call must sit in the function
the interval runs (a named function of the enclosing symbol, or the inline arrow), and a handler the symbol does not
define falls back to the whole enclosing symbol. That gives the plan's 6 on the base and 2 on #1720's head, and its
FIXTURE row holds the clock tick out.

## slug session-path-create-flows

`w7-session-path.test.ts` drives ten of the fourteen `sessionPathLiterals()` sites through their own doors, for an id
inside `isSessionIdShape`'s charset and one outside it. The other four (`NewSessionSheet`'s two `start` paths and
`useProgramAttempt`'s `finish` and `retry`) navigate only after a create or a kickoff answers; their paths are already
pinned by `new-session-sheet.test.tsx` (including an id with a space and a slash), `new-session-name.test.tsx` and
`start-program.test.tsx`, which C7k's Step 0 re-runs on its base with the rest.

## slug answer-paths-unit

The plan counts `answerPaths()` 3 without naming the unit. The query counts one site per answer lifecycle: a top-level
`pwa/src` symbol that calls an `api.answer*` member or `api.interrupt(…, 'deny')` (`DialogSheet`), a top-level symbol
that composes its own `busy` from an `answering` flag (`EnvelopeSheet`), and each hand-written `fetch(…/ask)` in
`pwa/public/push-sw.js` outside the generated markers (its one handler). So the mutation table's "a second hand-written
`fetch(… '/ask')` in `push-sw.js`" reds at 4.

## slug presence-reading-twin

`w7-presence-table.test.ts` marks a site's row SAME or DIFFERS against the verdict the site would give reading the
server's presence. By default that is the literal move: the same site over the row's twin whose `status` is `'dead'`
exactly when the presence is `dead`. Three readers are read by their own word instead: `hibernatedSince` over
`presence === 'asleep'`, and the coordinator readers (`coordPresence`, `orphanNote`, `RunRow`'s Resume door,
`SessionScreen`'s header orphan fact) over `coordPresence`'s four words read from the presence (`asleep` is its
`hibernated`, an absent presence `unknown`). A presence `unknown` reads as not dead under the twin, so the doubt rows
show as DIFFERS where a site's door would appear; OA-C15 (a) rules those (an `unknown` hides the door).

## slug transcript-corpus-derived

The PWA package reads no server fixture, so `w7-transcript-pairing.test.ts`'s corpus is the PWA's recorded asks:
every single-select question of every `askPanes.ts` envelope as the transcript's copy (`Dialog.ask`, every row
aligned) on every recorded parsed screen, with no hook envelope, plus `askFixtures.ts`' rows. 346 of them answer
`structured` `from: 'transcript'`; the 29 where the copy is placed are pinned whole, and the other 317 by their one
shared shape (shown read-only, unplaced, a tap sends nothing).

## Deferred, by coordinator call 3 (D-7221)

`pwa/test/w7-accounts-states.test.ts` and its three mutation rows land as C7b Step 1, after #1720 merges.
`accountsReaders()` and `requestPolls()` are band rows until then (1..5 and 2..6, the floor measured on #1720's head
`fad44037b`), and C7b pins them exact.

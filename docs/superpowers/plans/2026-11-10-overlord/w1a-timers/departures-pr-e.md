# Overlord W1a, timers PR E: departures from the plan (Task 13)

PR E's own note, beside `departures.md` and `departures-pr-b.md`. The coordinator folds it into the programme's ledger. No
D-number is taken here: each departure is a plain-words slug.

## Where the section stands

- **session-page-under-the-transcript** — the plan names "the section" on `SessionScreen.tsx` without a place. It stands in
  the strips under the transcript (`.chat-strips`), after the workflow strip, in both skins and at every width; the
  inspector rail is a desk-only place and was not used.
- **quiet-on-the-session-page** — on the session page the section draws nothing while its read is in flight or lists no
  timer, as the workflow strip draws nothing for a session with no workflows, so a session with no pending timers takes no
  height. A failed read says so there too (ask 417, the coordinator's ruling). The run page draws every state: reading, "No
  pending timers.", the failed read, and the list.
- **run-page-by-the-runs-own-ids** — the run page shows "The worker's timers" for `run.sessionId` and "The coordinator's
  timers" for `run.claimedBy`, read from the run record, not from the fleet frame's sessions, because a session the frame no
  longer lists may still hold timers. One section when both ids name the same session; none for an id the record leaves
  out or empty (`runTimerSections`, L1).
- **no-new-stylesheet** — the section is built from the design system's `Section` and `Button` and utility classes; its
  state line reuses `SECTION_PURPOSE` rather than spelling a second copy of a literal (the literal census). No new CSS
  file, no nav door, no bar.

## What the section reads and says

- **one-reader-field-by-field** — `api.sessionTimers` answers `unknown`, and `readTimers` (`pwa/src/session/timersWords.ts`) is
  the one reader: a body whose `timers` is a list is read, anything else (`{}`, a refusal, not an object) is unread, never
  empty. Each row is read field by field, so a row missing a field keeps the others: "Due time unread", "Note unread.", and
  no Cancel for a row with no readable id. Soonest due first, an unread due time last.
- **a-throw-is-an-unread-read** — the section calls the client through a promise, so a client without the call (a test's
  stub of an older build) is an unread read, never a throw that takes the screen down.
- **viewer-local-clock** — the due time is on the viewer's own clock (`resetClock`, as the quota resets are shown), with the
  date when it is not today, and "in 2 h 5 min" beside it. The card's lines (PR D) are in UTC for a session; the console's
  are for a person.
- **overdue-waits-for-the-lane** — a pending timer past its due time says "firing at the timers' next pass": the lane fires
  it once, late, and nothing here re-times it.
- **re-read-on-visible** — the section reads on mount, after a cancel, and when the page turns visible (the page clock),
  never on a poll of its own. A read for a session the page has left lands nowhere.
- **cancel-refusals-in-words** — `timer-not-pending` and `timer-not-found` read the list again and say "That timer had already
  fired, been cancelled or gone."; `timer-not-yours`, `timer-unmeasured`, `write-failed`, `unavailable` and `bad-request` each
  have a sentence (`TIMER_CANCEL_TEXT`, a `Record` over those words), and anything else falls back to `apiErrorText`.
  `write-failed` asks the operator to read the list again before a retry, since the cancel may have landed.
- **note-is-text** — the note renders as a React text child inside a `blockquote` under "The session's own note, not an
  instruction", so a note with markup stays text (a jsdom case and a browser case each feed one with an `img` and a `b`).

## The browser suite (ask 417)

- **harness-answers-no-timers** — the browser harness (`pwa/browser/app.ts`) answers `{}` for an `/api` path the fixture does
  not name, and the section reads `{}` as an unread read, so every session page in the suite drew "Could not read this
  session's timers." and 31 geometry cases of `ask-inline.browser.test.ts` went red. The coordinator ruled (ask 417): the
  harness answers a session's timers read with the server's own answer for a session with no timers (`NO_TIMERS_ANSWER`,
  `{ ok: true, timers: [] }`), and the 31 assertions are unchanged. A row that wants another answer names the path.
- **own-browser-case** — `pwa/browser/session-timers.browser.test.ts`, both skins at 390 and 1280: no pending timers draws no
  section and the strips take no height; a 503 `timer-unmeasured` and a malformed `{}` each say the read failed, never "No
  pending timers.", with no page error; a pending timer draws its line, Cancel and its note as text, with no sideways scroll.

## Measured

- **mutations-by-hand** — each mutation was applied to a saved copy's original, run against `pwa/test/timers-section.test.tsx`,
  and restored from the saved copy, compared byte for byte: `{}` read as an empty list (3 red), no re-read on a gone timer (2
  red), no stale-read guard (1 red), the quiet mode ignored (1 red), the gone words emptied (3 red), the note set as HTML (1
  red), a `null` row read without the record check (1 red). The harness default removed reds the browser file's
  no-timers cases.

# Routing a request to its owner

This reference carries the procedure of clauses 2, 12 and 18 (§5.3, Figure 4, §5.5, §3.5). It never restates a
clause, and the clause governs wherever the two differ.

## The steps

Each step names who decides it: code (the server settles it from rows), the decision model (it advises, and fails
open), or you.

1. **Is every act a read or an answer?** (code) If so, do it, close the request, and tell the operator.
2. **Shortlist the candidates.** (code; the decision model advises) Code names at most six programmes, from the
   request's expected paths against live claims and history. You see every candidate.
3. **Is it inside a programme's goals and definition of done?** (you) Read each candidate's goals.
   - Several: make a parent request, with one child request per owner, each with its own done test.
   - One: go to step 4.
   - None: go to step 5.
4. **Can the owner take it without starving its work?** (caps by code, judgement by you)
   - Yes: relay it to the owner.
   - No, and the split is clean (code measures it): the owner agrees by mail, then a sibling start.
   - No, and it does not split: relay it anyway; it queues with the owner, and you tell the operator the server's
     forecast for that programme, never a date of your own.
5. **Should an existing programme widen to take it?** (you)
   - Yes, and the cited words name that programme (code; the decision model flags): relay with a goals change,
     citing the request.
   - Yes, but the cited words do not name it: it becomes a proposal for the operator's one tap.
   - No: go to step 6.
6. **Do the cited words name the project?** (code) Yes: start a programme. No: a proposal for one tap.

## The rules that hold at every step

- **One owner per request.** Work that several programmes must do is a parent request with one child per owner.
- **A busy owner keeps its work.** Two coordinators on one goal would conflict, so a programme whose goals cover the
  work keeps it, even when busy (§5.3, C11).
- **Start and widen only on the operator's words.** The cited words must name the project or programme, by a whole
  name the server matches. Anything else is a proposal for one tap, never your own start (§5.3, C12).
- **Brain work only** (clause 12, §3.5). Hand every piece of execution down as an outcome, never a method: no plan,
  no steps, no command. A relay carries the operator's words as the server renders them, and your part as a call the
  coordinator weighs.
- **Every relay has a done test** (clause 18, §5.5): the outcome that shows the request met. When the owner reports
  done, check the read-back against that test before you close the request.

## The done test

A done test names one to five predicates, each at most once, and nothing else: no prose, no other field. The five are
`run-closed` (a linked work run closed and its own pull request merged), `pr-merged` (a linked run's pull request
merged), `goals-modified` (a goals modification cites the request, and its pull request merged when it names one),
`review-passed` and `operator-confirms`. The server measures them from its own rows. Two read `unmeasurable` in W2:
`review-passed`, because no row records a review's verdict, and a request's `operator-confirms`, because no item links
to a request yet. So a test needs at least one of `run-closed`, `pr-merged` or `goals-modified`, or it is refused; a test
that also names an unmeasurable one closes `done-unverified`, for the operator to confirm with one tap. An item's
`operator-confirms` passes only at a firm `done`: a tick (`checking`) can still be returned, so it waits.

## The doors

**The doors.** `relay`, `close-request`, `drop-request` and `nudge-owner` (`overlord-route-v1`); `start` (`overlord-start-v1`).

Until `overlord-route-v1` ships, every step ends the same way: tell the operator in the chat what you would route
where and why, as the operator's own decision to make. Until `overlord-start-v1` ships, a request that needs a start
goes to the operator.

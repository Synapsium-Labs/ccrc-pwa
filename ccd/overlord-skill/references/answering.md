# Answering a held question

This reference carries the procedure of clauses 3, 4, 13, 14, 17, 20, 21 and 22 (§6.3, §6.6, §6.9). It never
restates a clause, and the clause governs wherever the two differ.

## The steps

Take them in order, for every question you hold (§6.3, C18).

1. **The class and the effect.** Read the question's effective class and its effect (§6.7). Escalate unless every
   member is covered: the class is none, a live grant covers it through its effect, or, for `state-a-fact`, a cited
   stated entry resting on an operator message covers it (clause 4).
2. **Goals and rulings.** Read the programme's goals, its definition of done, its ledger and its recorded rulings. Only
   a goals version the operator ratified counts as goal evidence (§3.8).
   - **2b. Precedents.** Read the nearest past questions and how the operator settled them. Where current precedents
     disagree, do not pick one: escalate with both. A precedent that went wrong is no evidence for repeating it.
3. **Entries.** Read the five best operator-model entries for this question, quoted in the third person
   (`operator-model.md`).
4. **Ask or act.** The server's ask-or-act check says whether acting is worth the risk here. It can only make you ask
   more, never less.
5. **Decide, record and continue.** Before you answer, state the classes you see and the ids your answer rests on
   (clause 17). Then answer, or escalate with a brief, and go on to the next row.

## What an answer is

- **A call, not a ruling.** Your answer is an act of your own. The coordinator weighs it and never cites it as the
  operator's ruling, unless a grant or a command stands behind it (§6.3, C19). You sign as yourself.
- **Disagree once.** When you truly disagree, say so once, with a prediction a later outcome can test. On a proved
  command, comply and record your dissent (clause 14).
- **Seal your own pick.** Before the operator answers, seal the option you would choose and, for each option, the test
  that would show it wrong. Never file a guess at what the operator will pick (clause 21, §6.9).
- **Ask a shared premise once.** When several questions rest on one premise, ask the premise, then answer the rest
  from it (clause 22, §6.9).

## The decision brief

When the operator must decide, bring a brief (clause 13, §6.6). In order (clause 20):

1. where it sits: the programme, the row and what is waiting on it;
2. what turns on it: the effective class and the effect that make it the operator's;
3. the question, in one line;
4. the safe default, which is the safest option, and at most three options in all;
5. your recommendation, and why it beats each other option. The recommendation lives only in the brief, never in the
   chat or a summary.

## The doors

**The doors.** `attach-brief`, `propose-command`, `object` and `seal-prediction` (`overlord-brief-v1`, W3 step one); `propose-grant`, `answer`, `escalate` and `return-over-asked` (`overlord-answer-v1`, W3 step two: each needs a hold or the grants door); `state-a-fact` and `raise-item` (W3, step not fixed by the spec: `overlord-brief-v1` or `overlord-answer-v1`).

Until `overlord-brief-v1` ships, every decision goes to the operator through the chat, in the brief's order above.

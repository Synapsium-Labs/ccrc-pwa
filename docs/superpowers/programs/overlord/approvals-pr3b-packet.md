# Approvals PR 3b: the route hunks that wire the park (packet, not applied)

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md`, §3.3 and Tasks 3.1 to 3.3. Split from PR 3 by the coordinator's
ruling of 2026-11-19: the held route file (`server/src/coord/routes.ts`, claim 5629 of a frozen run) takes these hunks once its
claim is released. PR 3 built every function they call, with its own tests, and holds the lane inert by its gate.

Size: about 9 lines in `server/src/coord/routes.ts`, 1 in `server/src/server.ts`, the gate lift in `shared/lane-arm.ts`, the
grace constant's move, and the route tests below.

## H1. The request route's `201` carries the park's word

In `app.post('/api/approvals', …)`, the `minted` case:

```ts
      case 'minted': {
        const accepted: ApprovalRequestAccepted = { id: v.id, waitS: v.waitS, ...(v.park === null ? {} : { park: v.park }) };
        return reply.code(201).send(accepted);
      }
```

## H2. The ruling read records `fetchedAt`

In `app.get('/api/approvals/:id/ruling', …)`, the three lines that build `answer` become one call to the questions owner:

```ts
    const answer: ApprovalRulingAnswer = questions.approvalRulingAnswer(row, Date.now(), APPROVAL_RULED_GRACE_MS);
```

`APPROVAL_RULED_GRACE_MS` lives in `server/src/watch.ts` today, which `routes.ts` imports as a type only. PR 3b moves the
constant to `server/src/askwindow.ts` (L1, beside the windows it qualifies), exported, and `watch.ts` imports it from there:
one definition, read by both.

## H3. The operator door's `approval-<n>` arm

In `app.post('/api/questions/:id/answer', …)`, before the `kind-mismatch` line:

```ts
    if (qid.kind === 'approval') return approvalOperatorArm(req, reply, qid.id, { gate: wiring.gate, questions });
    if (qid.kind !== 'session') return refuseRoute(reply, 'kind-mismatch');
```

with `import { approvalOperatorArm } from './approvalParkDoor.js';`, and `OperatorDoorWiring` gaining the account gate:

```ts
export interface OperatorDoorWiring {
  readonly knownId: (id: string) => Promise<boolean>;
  readonly answerDeps: OperatorDoorDeps;
  /** Approvals PR 3b: the account gate, for the `approval-<n>` arm's step-up. */
  readonly gate: AccountGate;
}
```

`server/src/server.ts`, where the operator door's wiring is built: one line, `gate: accountGate` (the gate the other step-up
doors are handed). An `ask-<n>` id is still `kind-mismatch`.

## H4. The claimant door's deps carry the deny standing (closes PR 0's residual)

In `registerCoordRoutes`, `claimantDeps` gains the existing closure: `denyStanding,`. The one signing site then re-checks the
child's deny currency at signing for the claimant's in-window allow too, as it already does for a retry.

## The lane's gate

`shared/lane-arm.ts`'s `approval-park` row keeps its gate until BOTH hold: H1 to H4 are on the server, and PR 3v (the
verifier's v2 rule, `approvals-pr3-verifier-patch.md`) is on the fleet box. Then the gate's words go (`gate: null`), and Live is
the operator's, behind the card's step-up, refused while sign-in is dark. If PR 3b lands before PR 3v, its gate text names the
verifier as what Live still waits for.

## Its tests (red first against PR 3's tree)

- `approvals-routes.test.ts` or a new route suite: the `201` carries `park` (`live` with the lane opened by a test gate,
  `shadow` by default); the ruling read answers `{state: 'parked'}` for a parked row, and records `fetchedAt` once when it
  serves a ruling the grace before expiry, never later.
- `question-doors-pin.test.ts`: an `approval-<n>` id with body `{kind: 'approval', verdict}` reaches the arm (the gate's
  `auth-off` while dark, a step-up when armed); an `approval-<n>` id with body kind `ask` or `dialog` is refused; a
  `session-<id>` answer still presses; an `ask-<n>` id is still `kind-mismatch`. The arm's press-free core is PR 3's
  (`approval-park.test.ts`); here the route's ladder.
- The claimant door's F2 case through the route: a row minted current whose managed deny file changed before the ruling is
  refused `deny-not-current` at signing.
- Mutations: the `201` without `park`; the ruling read not recording; the arm answering `kind-mismatch`; `claimantDeps`
  without `denyStanding`.
- The censuses: no new door (the arm is a path of the existing operator door), so `box-token-census.test.ts` and
  `auth-gate.test.ts` are unchanged; re-run them.

## Before Live

Task 3.2's measurement before Live: on a fixture child under the current build, whether a model retries a parked command
unchanged, and whether the park burns a turn. It goes in PR 3b's note, and the lane stays shadow until it is read.

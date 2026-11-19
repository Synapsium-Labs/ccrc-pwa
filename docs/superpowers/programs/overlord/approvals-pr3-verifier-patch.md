# Approvals PR 3v: the verifier's v2 rule for `operator` (patch, not applied)

Plan: `docs/superpowers/plans/2026-11-18-overlord-approvals.md`, §3.6 (Table 3b's v1, `coordinator` and `operator` rows) and
Task 3.3's verifier case. Split from PR 3 by the coordinator's ruling of 2026-11-19 (option (a)): a dispatched child never
edits the hook's ruling verifier, and the session hook refuses that edit, so this change is its own small pull request.
Who makes it is the operator's call. This file is the exact change and its cases, as text.

## Why PR 3 ships safely without it

- PR 3's lane is gated (`shared/lane-arm.ts`, the `approval-park` row's gate words), so nothing parks and no v2 record is
  ever signed in PR 3.
- An unchanged verifier refuses any record that is not exactly v1's ten fields, so a v2 record prints nothing and the menu
  paints: Table 3b's own "older verifier" row. PR 3 pins that (`approval-park-verifier-v1.test.ts`).
- The session hook in PR 3 already reads the v2 lines this patch makes the verifier print (`allow:operator <reason>`,
  `deny:operator <reason>`, `deny:overlord <reason>`), and names the ruler in a deny. Until this patch lands it never sees
  one.
- PR 3b's arming check must refuse `live` until this patch is on the fleet box too (the coordinator's ruling).

## The change

### The type declarations (the `.d.mts` beside the verifier)

```ts
export const RECORD_KEYS_V2: readonly string[];
export const AUTHORITIES: readonly string[];
export const FAMILIES: readonly string[];
```

### The verifier (the `.mjs`)

1. Its header comment: a v2 record prints `allow:<authority> <reason>` or `deny:<authority> <reason>`; v2 is v1's ten fields
   plus `authority`, `denyCurrent` and `family`; only the `operator` authority is issued in PR 3, family `none`, checked
   against the main key (the one pinned key); an operator allow admits class `ordinary` or `escalate` at any deny currency,
   never `forbidden`.
2. After `RECORD_KEYS`:

```js
/** A v2 record's thirteen (approvals PR 3). */
export const RECORD_KEYS_V2 = Object.freeze([...RECORD_KEYS, 'authority', 'denyCurrent', 'family']);
/** THE DOCUMENTED SECOND COPIES of `APPROVAL_RULING_AUTHORITIES` and `APPROVAL_RULING_FAMILIES` (shared/api.ts), held equal
 *  by the verifier's suite. */
export const AUTHORITIES = Object.freeze(['coordinator', 'operator', 'overlord']);
export const FAMILIES = Object.freeze(['none', 'read-only']);
```

3. `recordBytes`:

```js
export function recordBytes(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null;
  const want = r.v === 2 ? RECORD_KEYS_V2 : RECORD_KEYS;
  const keys = Object.keys(r);
  if (keys.length !== want.length || !want.every((k) => Object.prototype.hasOwnProperty.call(r, k))) return null;
  return canonical(r);
}
```

4. `verdictFor`, from the signature check on:

```js
  if (!good) return null;
  if (r.v !== 1 && r.v !== 2) return null;
  if (r.sessionId !== expected.sessionId || r.agentId !== expected.agentId || r.digest !== expected.digest
      || r.nonce !== expected.nonce || r.rowId !== expected.rowId) return null;
  if (!Number.isInteger(r.expiresAt) || r.expiresAt <= expected.now) return null;
  if (typeof r.reason !== 'string') return null;
  if (r.v === 1) {
    if (r.verdict === 'allow') return r.class === 'ordinary' ? `allow ${oneLine(r.reason)}` : null;
    if (r.verdict === 'deny') return `deny ${oneLine(r.reason)}`;
    return null;
  }
  // v2 (Table 3b): only the operator's authority is issued in PR 3, family `none`, and the main key (the one pinned here).
  if (!AUTHORITIES.includes(r.authority) || !FAMILIES.includes(r.family) || typeof r.denyCurrent !== 'boolean') return null;
  if (r.authority !== 'operator' || r.family !== 'none') return null;
  if (r.verdict === 'allow') return r.class === 'ordinary' || r.class === 'escalate' ? `allow:operator ${oneLine(r.reason)}` : null;
  if (r.verdict === 'deny') return `deny:operator ${oneLine(r.reason)}`;
  return null;
```

## Its red cases (the verifier's own suite under `server/test/`)

Each signs a record with a key pair the test generates and asks `verdictFor` over its public half:

1. v1: an `ordinary` allow prints `allow <reason>`; an `escalate` allow prints nothing; a deny prints `deny <reason>` (today's
   rows, unchanged).
2. v2 `coordinator`, allow and deny: prints nothing (a v2 coordinator record is never issued).
3. v2 `operator` allow of `escalate`, `denyCurrent: false`: prints `allow:operator <reason>`.
4. v2 `operator` allow of `ordinary`: prints `allow:operator <reason>`.
5. v2 `operator` allow of `forbidden`: prints nothing.
6. v2 `operator` deny: prints `deny:operator <reason>`.
7. v2 `overlord`, any verdict: prints nothing (PR 5 and PR 6).
8. v2 with `family: read-only`, or an unknown family or authority, or `denyCurrent` not a boolean: prints nothing.
9. v2 with a fourteenth field, or missing one of the thirteen: prints nothing.
10. A v2 record signed by another key: prints nothing.
11. The second copies: `AUTHORITIES` and `FAMILIES` equal `APPROVAL_RULING_AUTHORITIES` and `APPROVAL_RULING_FAMILIES`, and
    `recordBytes` of a v2 record equals `approvalRulingBytes` of it.

Mutations, each restored from a saved copy: accept a v2 `coordinator` record (case 2 reds); accept `forbidden` for the
operator (case 5 reds); accept family `read-only` (case 8 reds); check v2 against v1's ten keys (cases 3, 4 and 6 red).

After it lands, `session-hook-approval-park.test.ts` can swap its stub verifier for the real one in one case: a signed v2
operator deny prints "denied by the operator: <reason>" end to end.

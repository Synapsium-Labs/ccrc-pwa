// THE PARK'S VOCABULARY (approvals plan 2026-11-18, §3.3 and §3.6; approvals PR 3). L0: it imports nothing, because the PWA
// bundles it (Waiting on you's parked group reads `ParkedApprovalView` through it). Beside `shared/api.ts`'s approval section
// for that file's size cap: the record v2 type and `approvalRulingBytes` stay there, with the record they extend.

/** Who a v2 record's ruling is from (approvals plan 2026-11-18, Table 3g): `operator` from PR 3, `overlord` from PR 5. A
 *  `coordinator` ruling is always signed v1, so a v2 record naming `coordinator` is never issued and the verifier
 *  refuses it. Spelled once; the verifier's documented second copy is held equal by `approval-verify.test.ts`. */
export const APPROVAL_RULING_AUTHORITIES = ['coordinator', 'operator', 'overlord'] as const;
export type ApprovalRulingAuthority = (typeof APPROVAL_RULING_AUTHORITIES)[number];
/** A v2 record's family (Table 3e): `none` for every record of PR 3; `read-only` is PR 6's. */
export const APPROVAL_RULING_FAMILIES = ['none', 'read-only'] as const;
export type ApprovalRulingFamily = (typeof APPROVAL_RULING_FAMILIES)[number];

/** The park's word, decided once at mint and stored on the row as `parkWord` (approvals plan 2026-11-18, §3.3.1 F1):
 *  `live` (the row parks past its window, and holds one of its key's `APPROVAL_PARK_SLOTS`), `shadow` (the lane is not
 *  live, or sign-in is dark: nothing parks, and a lapse records `wouldPark`), or `capped` (the key's last slot is taken).
 *  The `201` carries it as `park`; the hook parks only on an exact `live`, and an absent field reads as `shadow`. */
export const APPROVAL_PARK_WORDS = ['live', 'shadow', 'capped'] as const;
export type ApprovalParkWord = (typeof APPROVAL_PARK_WORDS)[number];
export function isApprovalParkWord(v: unknown): v is ApprovalParkWord {
  return typeof v === 'string' && (APPROVAL_PARK_WORDS as readonly string[]).includes(v);
}
/** A parked row as Waiting on you lists it (approvals plan 2026-11-18, §3.3.2): who holds it (`coordinator`, "with your
 *  coordinator", in AP1), the redacted facts the operator rules from, the park's horizon, and the park's unspent ruling
 *  if a principal already gave one (the row then waits for the child's retry, and another ruling is refused `park-ruled`). */
export interface ParkedApprovalView {
  readonly id: number;
  readonly childId: string;
  readonly parentId: string;
  readonly runId: number | null;
  readonly agentId: string;
  readonly tool: string;
  readonly input: string | null;
  readonly class: string;
  readonly denyCurrent: boolean;
  readonly askAt: number;
  readonly horizon: number | null;
  readonly holder: 'coordinator';
  readonly ruled: { readonly verdict: 'allow' | 'deny'; readonly authority: ApprovalRulingAuthority } | null;
}
/** A park's horizon from its first park (open question 5), and the parks one key may hold (open question 6). */
export const APPROVAL_PARK_HORIZON_MS = 2 * 60 * 60 * 1000;
export const APPROVAL_PARK_SLOTS = 3;
/** The park deny the hook prints (F16): it tells the model to wait for the ruling's mail, so retries do not spend the
 *  cap. The hook's bash copy is held equal by `session-hook-approval-park.test.ts`. */
export const approvalParkDenyText = (id: number): string => `approval ${id} is parked for a ruling. Do not run this command `
  + 'again now: wait for the mail that says it was ruled, then run the same command again, unchanged.';

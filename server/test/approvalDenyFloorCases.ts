// The stale deny digest's two deciders, case by case (Overlord approvals PR 0, plan 2026-11-18-overlord-approvals.md
// §3.2.1, Task 0.4, as the coordinator's plan-review rulings of 2026-11-18 reshaped it): `denyStandingOf` (current,
// history or none, from the child's spawn digest, the managed file's digest and the installer's digest history) and
// `approvalAllowRefusal` (the rule door's allow check: no allow on a row whose deny rules are not current). One list of named cases, run by `approvalDenyFloor.test.ts` and by the mutation floors'
// `approvalDenyFloorSets.ts` over a mutated copy of the module. Neutral digests only.
import { expect } from 'vitest';

export interface ApprovalDenyFloorModule {
  denyStandingOf(child: string | null, managed: string | null, history: string | null): 'current' | 'history' | 'none';
  approvalAllowRefusal(rowClass: string, again: 'ordinary' | 'escalate' | 'forbidden', denyCurrent: boolean): 'guard-forbidden' | 'deny-not-current' | 'guard-escalate' | null;
  readonly CHILD_DENY_DIGESTS_FILE: string;
  readonly CHILD_DENY_DIGESTS_MAX: number;
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const line = (d: string, ms = 1795000000000): string => `${d} ${ms}\n`;
/** A history of `n` distinct digests, oldest first, each a 64-hex string from its index. */
const many = (n: number): string[] => Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, '0'));

export interface DenyFloorCase { readonly name: string; run(m: ApprovalDenyFloorModule): void }

export const APPROVAL_DENY_FLOOR_CASES: readonly DenyFloorCase[] = [
  { name: 'the names: the history file and its bound', run: (m) => {
    expect(m.CHILD_DENY_DIGESTS_FILE).toBe('child-deny.digests');
    expect(m.CHILD_DENY_DIGESTS_MAX).toBe(32);
  } },
  { name: 'a digest equal to the managed one is current, whatever the history says', run: (m) => {
    expect(m.denyStandingOf(A, A, null)).toBe('current');
    expect(m.denyStandingOf(A, A, '')).toBe('current');
    expect(m.denyStandingOf(A, A, line(B))).toBe('current');
  } },
  { name: 'an older digest the history names is history', run: (m) => {
    expect(m.denyStandingOf(A, B, line(A) + line(B))).toBe('history');
    expect(m.denyStandingOf(A, B, line(C) + line(A) + line(B))).toBe('history');
  } },
  { name: 'a digest the history does not name is none, and so is any digest with no history', run: (m) => {
    expect(m.denyStandingOf(A, B, line(C) + line(B))).toBe('none');
    expect(m.denyStandingOf(A, B, null)).toBe('none');
    expect(m.denyStandingOf(A, B, '')).toBe('none');
  } },
  { name: 'an unreadable managed file is none, even for a digest the history names', run: (m) => {
    expect(m.denyStandingOf(A, null, line(A))).toBe('none');
  } },
  { name: 'no child digest, or one not 64 lowercase hex, is none', run: (m) => {
    expect(m.denyStandingOf(null, B, line(A))).toBe('none');
    expect(m.denyStandingOf(A.toUpperCase(), B, line(A.toUpperCase()))).toBe('none');
    expect(m.denyStandingOf(A.slice(1), B, line(A.slice(1)))).toBe('none');
    expect(m.denyStandingOf('', '', '')).toBe('none');
  } },
  { name: 'a managed digest not 64 lowercase hex is never current, and reads no history', run: (m) => {
    expect(m.denyStandingOf(A.slice(1), A.slice(1), null)).toBe('none');
    expect(m.denyStandingOf(A.toUpperCase(), A.toUpperCase(), null)).toBe('none');
    expect(m.denyStandingOf(A, 'x', line(A))).toBe('none');
  } },
  { name: 'only a line of the exact shape counts: digest, one space, epoch ms', run: (m) => {
    expect(m.denyStandingOf(A, B, `${A}\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, `${A}  1795000000000\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, ` ${A} 1795000000000\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, `${A} 1795000000000 extra\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, `${A} 17950000x0000\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, `x${A} 1795000000000\n`)).toBe('none');
    expect(m.denyStandingOf(A, B, `${A} 1795000000000`)).toBe('history');
    expect(m.denyStandingOf(A, B, `${A} 1795000000000\r\n`)).toBe('none');
  } },
  { name: 'a malformed line elsewhere does not hide a good one', run: (m) => {
    expect(m.denyStandingOf(A, B, `garbage\n${line(A)}not a line\n`)).toBe('history');
  } },
  { name: 'only the newest 32 lines are read: the 33rd from the end is forgotten', run: (m) => {
    const ds = many(33);
    const text = ds.map((d) => line(d)).join('');
    expect(m.denyStandingOf(ds[0]!, B, text)).toBe('none');
    expect(m.denyStandingOf(ds[1]!, B, text)).toBe('history');
    expect(m.denyStandingOf(ds[32]!, B, text)).toBe('history');
    // Trailing blank lines are not lines of the history: they do not push the oldest out.
    expect(m.denyStandingOf(ds[1]!, B, `${text}\n\n`)).toBe('history');
  } },
  { name: 'the allow check: an ordinary row, ordinary again, under current rules may be signed', run: (m) => {
    expect(m.approvalAllowRefusal('ordinary', 'ordinary', true)).toBeNull();
  } },
  { name: 'the allow check: a row whose deny rules are not current is refused deny-not-current, whatever its class short of forbidden', run: (m) => {
    expect(m.approvalAllowRefusal('ordinary', 'ordinary', false)).toBe('deny-not-current');
    expect(m.approvalAllowRefusal('escalate', 'ordinary', false)).toBe('deny-not-current');
    expect(m.approvalAllowRefusal('ordinary', 'escalate', false)).toBe('deny-not-current');
  } },
  { name: 'the allow check: escalate on either side is guard-escalate, whatever the rules', run: (m) => {
    expect(m.approvalAllowRefusal('escalate', 'ordinary', true)).toBe('guard-escalate');
    expect(m.approvalAllowRefusal('ordinary', 'escalate', true)).toBe('guard-escalate');
    expect(m.approvalAllowRefusal('a-newer-word', 'ordinary', true)).toBe('guard-escalate');
  } },
  { name: 'the allow check: forbidden on either side is guard-forbidden, before any other word', run: (m) => {
    expect(m.approvalAllowRefusal('forbidden', 'ordinary', true)).toBe('guard-forbidden');
    expect(m.approvalAllowRefusal('ordinary', 'forbidden', true)).toBe('guard-forbidden');
    expect(m.approvalAllowRefusal('forbidden', 'escalate', false)).toBe('guard-forbidden');
    expect(m.approvalAllowRefusal('escalate', 'forbidden', false)).toBe('guard-forbidden');
  } },
];

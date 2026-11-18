// The stale deny digest's two deciders, case by case (Overlord approvals PR 0, plan 2026-11-18-overlord-approvals.md
// §3.2.1, Task 0.4): `denyStandingOf` (current, history or none, from the child's spawn digest, the managed file's
// digest and the installer's digest history) and `approvalClassFloor` (a child under older deny rules is never
// `ordinary`). One list of named cases, run by `approvalDenyFloor.test.ts` and by the mutation floors'
// `approvalDenyFloorSets.ts` over a mutated copy of the module. Neutral digests only.
import { expect } from 'vitest';

export interface ApprovalDenyFloorModule {
  denyStandingOf(child: string | null, managed: string | null, history: string | null): 'current' | 'history' | 'none';
  approvalClassFloor(cls: 'ordinary' | 'escalate' | 'forbidden', denyCurrent: boolean): 'ordinary' | 'escalate' | 'forbidden';
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
  { name: 'the floor: under the current rules every class is itself', run: (m) => {
    expect(m.approvalClassFloor('ordinary', true)).toBe('ordinary');
    expect(m.approvalClassFloor('escalate', true)).toBe('escalate');
    expect(m.approvalClassFloor('forbidden', true)).toBe('forbidden');
  } },
  { name: 'the floor: under older rules ordinary rises to escalate, and nothing falls', run: (m) => {
    expect(m.approvalClassFloor('ordinary', false)).toBe('escalate');
    expect(m.approvalClassFloor('escalate', false)).toBe('escalate');
    expect(m.approvalClassFloor('forbidden', false)).toBe('forbidden');
  } },
];

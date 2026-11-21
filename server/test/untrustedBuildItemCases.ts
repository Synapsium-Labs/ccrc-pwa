// The untrusted-build item's deciders, case by case (approvals plan 2026-11-18, §3.2.2 and Task 2.2; narrowed by slug
// item-only-when-given-up, `docs/superpowers/programs/overlord/claude-release-unattended.md`): `untrustedBuildItemOf` (the item
// a build ccrc has given up on raises, keyed by the build), `openUntrustedBuildItems` (the open items by their build) and
// `untrustedBuildItemsToSettle` (the items whose build ccrc has not given up on, each with its note). One list of named cases,
// run by `approval-untrusted-build.test.ts` and by the mutation floors' `approvalEnvelopeSets.ts` over a mutated copy of the
// module.
import { expect } from 'vitest';
import type { ClaudeBuildRecord } from '../../shared/claudeBuildTrust.js';
import type { ItemAction } from '../../shared/ledgers.js';
import type { RaiseItemInput } from '../src/coord/ledgersStore.js';

export interface UntrustedBuildItemModule {
  untrustedBuildItemOf(openBuilds: ReadonlySet<string>, row: ClaudeBuildRecord): RaiseItemInput | null;
  openUntrustedBuildItems(open: readonly { readonly id: number; readonly action?: ItemAction | null }[]): { id: number; build: string }[];
  untrustedBuildItemsToSettle(open: readonly { readonly id: number; readonly build: string }[], records: readonly ClaudeBuildRecord[] | null): { id: number; build: string; note: string }[];
  readonly UNTRUSTED_BUILD_ITEM_PROGRAMME: string;
  readonly UNTRUSTED_BUILD_SETTLED_NOTES: { readonly captured: string; readonly handled: string };
}

const NONE: ReadonlySet<string> = new Set();
/** A record row, as `claude_builds` holds it: `pass` is trusted; a `fail` carries its count of failed verdicts. */
const rec = (build: string, capture: ClaudeBuildRecord['capture'], fails = capture === 'fail' ? 3 : 0): ClaudeBuildRecord => ({
  build, source: 'fleet', capture, cwd: capture === 'pass', seenAt: 1, attempts: capture === 'queued' ? 0 : Math.max(1, fails), lastAttemptAt: null,
  notSent: null, verdictAt: capture === 'queued' ? null : 2, output: null, fails,
});

export interface UntrustedBuildCase { readonly name: string; run(m: UntrustedBuildItemModule): void }

export const UNTRUSTED_BUILD_ITEM_CASES: readonly UntrustedBuildCase[] = [
  { name: 'a build ccrc has given up on raises one item, keyed by the build, on the Overlord\'s programme', run: (m) => {
    const input = m.untrustedBuildItemOf(NONE, rec('2.1.330', 'fail', 3));
    expect(input).not.toBeNull();
    expect(input!.action).toEqual({ verb: 'untrusted-build', build: '2.1.330' });
    expect(input!.program).toBe(m.UNTRUSTED_BUILD_ITEM_PROGRAMME);
    expect(m.UNTRUSTED_BUILD_ITEM_PROGRAMME).toBe('overlord');
    expect(input!.kind).toBe('do');
    expect(input!.raisedBy).toBe('ccrc');
    expect(input!.runId).toBeNull();
    expect(input!.neededBy).toBe('soon');
    expect(input!.title).toBe('Claude Code 2.1.330 failed its capture 3 times, and ccrc has stopped retrying');
    expect(input!.why).toContain('the replay tests failed 3 times');
  } },
  { name: 'its steps link the Settings section holding the build\'s row and name the act only the operator can do, Capture again', run: (m) => {
    const how = m.untrustedBuildItemOf(NONE, rec('2.1.330', 'fail', 4))!.how;
    expect(how[0]).toBe('Open /settings/automation and find Claude Code 2.1.330 in the Test box\'s build list: its replay output says what failed.');
    expect(how.join(' ')).toContain('choose Capture again. Only you can');
  } },
  { name: 'NOTHING WAITS WHILE CCRC HANDLES IT: a build with no verdict, one being captured again, or a trusted one raises none', run: (m) => {
    expect(m.untrustedBuildItemOf(NONE, rec('2.1.330', 'queued'))).toBeNull();
    expect(m.untrustedBuildItemOf(NONE, rec('2.1.330', 'fail', 1))).toBeNull();
    expect(m.untrustedBuildItemOf(NONE, rec('2.1.330', 'fail', 2))).toBeNull();
    expect(m.untrustedBuildItemOf(NONE, rec('2.1.330', 'pass'))).toBeNull();
  } },
  { name: 'no build to key it by raises none', run: (m) => {
    expect(m.untrustedBuildItemOf(NONE, rec('not-a-version', 'fail', 3))).toBeNull();
  } },
  { name: 'THE KEY: a build whose item is open raises none; another build still raises', run: (m) => {
    expect(m.untrustedBuildItemOf(new Set(['2.1.330']), rec('2.1.330', 'fail', 3))).toBeNull();
    expect(m.untrustedBuildItemOf(new Set(['2.1.330']), rec('2.1.331', 'fail', 3))).not.toBeNull();
  } },
  { name: 'the open items, by build: only untrusted-build actions', run: (m) => {
    expect(m.openUntrustedBuildItems([
      { id: 1, action: { verb: 'untrusted-build', build: '2.1.330' } },
      { id: 2, action: null },
      { id: 3 },
      { id: 4, action: { verb: 'linear-initiatives', workspaceId: 'w' } },
      { id: 5, action: { verb: 'untrusted-build', build: '2.1.331' } },
    ])).toEqual([{ id: 1, build: '2.1.330' }, { id: 5, build: '2.1.331' }]);
  } },
  { name: 'every item settles but a given-up build\'s: a captured build with its note, one ccrc still handles (queued, failed below the ceiling, unrecorded) with the other', run: (m) => {
    const open = [{ id: 1, build: '2.1.330' }, { id: 2, build: '2.1.331' }, { id: 3, build: '2.1.332' }, { id: 4, build: '2.1.333' }, { id: 5, build: '2.1.334' }];
    const records = [rec('2.1.330', 'pass'), rec('2.1.331', 'queued'), rec('2.1.332', 'fail', 1), rec('2.1.334', 'fail', 3)];
    const { captured, handled } = m.UNTRUSTED_BUILD_SETTLED_NOTES;
    expect(captured).not.toBe(handled);
    expect(m.untrustedBuildItemsToSettle(open, records)).toEqual([
      { id: 1, build: '2.1.330', note: captured }, { id: 2, build: '2.1.331', note: handled },
      { id: 3, build: '2.1.332', note: handled }, { id: 4, build: '2.1.333', note: handled },
    ]);
  } },
  { name: 'a record that could not be read settles nothing', run: (m) => {
    expect(m.untrustedBuildItemsToSettle([{ id: 1, build: '2.1.330' }], null)).toEqual([]);
  } },
];

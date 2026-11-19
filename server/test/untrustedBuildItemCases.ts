// The untrusted-build item's deciders, case by case (approvals plan 2026-11-18, §3.2.2 and Task 2.2): `untrustedBuildItemOf`
// (the item a `version-unverified` refusal raises, keyed by the build), `openUntrustedBuildItems` (the open items by their
// build) and `untrustedBuildItemsToSettle` (the items whose build passed its capture). One list of named cases, run by
// `approval-untrusted-build.test.ts` and by the mutation floors' `approvalEnvelopeSets.ts` over a mutated copy of the module.
import { expect } from 'vitest';
import type { BuildUntrustedReason, ClaudeBuildRecord } from '../../shared/claudeBuildTrust.js';
import type { ItemAction } from '../../shared/ledgers.js';
import type { RaiseItemInput } from '../src/coord/ledgersStore.js';

export interface UntrustedBuildItemModule {
  untrustedBuildItemOf(openBuilds: ReadonlySet<string>, version: string | null, reason: BuildUntrustedReason): RaiseItemInput | null;
  openUntrustedBuildItems(open: readonly { readonly id: number; readonly action?: ItemAction | null }[]): { id: number; build: string }[];
  untrustedBuildItemsToSettle(open: readonly { readonly id: number; readonly build: string }[], records: readonly ClaudeBuildRecord[] | null): { id: number; build: string }[];
  readonly UNTRUSTED_BUILD_ITEM_PROGRAMME: string;
}

const NONE: ReadonlySet<string> = new Set();
/** A record row, as `claude_builds` holds it: `pass` is trusted, the rest are not. */
const rec = (build: string, capture: ClaudeBuildRecord['capture']): ClaudeBuildRecord => ({
  build, source: 'fleet', capture, cwd: capture === 'pass', seenAt: 1, attempts: capture === 'queued' ? 0 : 1, lastAttemptAt: null,
  notSent: null, verdictAt: capture === 'queued' ? null : 2, output: null,
});

export interface UntrustedBuildCase { readonly name: string; run(m: UntrustedBuildItemModule): void }

export const UNTRUSTED_BUILD_ITEM_CASES: readonly UntrustedBuildCase[] = [
  { name: 'a refusal for a build with no open item raises one, keyed by the build, on the Overlord\'s programme', run: (m) => {
    const input = m.untrustedBuildItemOf(NONE, '2.1.330', 'not-captured');
    expect(input).not.toBeNull();
    expect(input!.action).toEqual({ verb: 'untrusted-build', build: '2.1.330' });
    expect(input!.program).toBe(m.UNTRUSTED_BUILD_ITEM_PROGRAMME);
    expect(m.UNTRUSTED_BUILD_ITEM_PROGRAMME).toBe('overlord');
    expect(input!.kind).toBe('do');
    expect(input!.raisedBy).toBe('ccrc');
    expect(input!.runId).toBeNull();
    expect(input!.neededBy).toBe('soon');
    expect(input!.title).toBe('Children on Claude Code 2.1.330 cannot route permission prompts until it is captured');
    expect(input!.why).toContain('2.1.330 has no capture yet');
  } },
  { name: 'its control (review 2752 F4): the first step links the Settings section holding the build\'s row and its Capture again, and the text says plainly that a waiting build waits for a test box', run: (m) => {
    const how = m.untrustedBuildItemOf(NONE, '2.1.330', 'capture-queued')!.how;
    expect(how[0]).toBe('Open /settings/automation and find Claude Code 2.1.330 in the Test box\'s build list.');
    expect(how.join(' ')).toContain('A build waiting for its capture stays waiting while no test box can capture it');
    expect(how.join(' ')).toContain('Capture again');
  } },
  { name: 'every reason that is a fact about the build raises: not captured, queued, failed', run: (m) => {
    for (const r of ['not-captured', 'capture-queued', 'capture-failed'] as const) expect(m.untrustedBuildItemOf(NONE, '2.1.330', r)).not.toBeNull();
  } },
  { name: 'a read failure raises none: the build could not be read, or the record could not', run: (m) => {
    expect(m.untrustedBuildItemOf(NONE, '2.1.330', 'unread')).toBeNull();
    expect(m.untrustedBuildItemOf(NONE, '2.1.330', 'record-unreadable')).toBeNull();
  } },
  { name: 'no build to key it by raises none', run: (m) => {
    expect(m.untrustedBuildItemOf(NONE, null, 'not-captured')).toBeNull();
    expect(m.untrustedBuildItemOf(NONE, 'not-a-version', 'not-captured')).toBeNull();
  } },
  { name: 'THE KEY: a build whose item is open raises none; another build still raises', run: (m) => {
    expect(m.untrustedBuildItemOf(new Set(['2.1.330']), '2.1.330', 'not-captured')).toBeNull();
    expect(m.untrustedBuildItemOf(new Set(['2.1.330']), '2.1.331', 'not-captured')).not.toBeNull();
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
  { name: 'a captured build settles its item; one still queued, failed or unrecorded does not', run: (m) => {
    const open = [{ id: 1, build: '2.1.330' }, { id: 2, build: '2.1.331' }, { id: 3, build: '2.1.332' }, { id: 4, build: '2.1.333' }];
    const records = [rec('2.1.330', 'pass'), rec('2.1.331', 'queued'), rec('2.1.332', 'fail')];
    expect(m.untrustedBuildItemsToSettle(open, records)).toEqual([{ id: 1, build: '2.1.330' }]);
  } },
  { name: 'a record that could not be read settles nothing', run: (m) => {
    expect(m.untrustedBuildItemsToSettle([{ id: 1, build: '2.1.330' }], null)).toEqual([]);
  } },
];

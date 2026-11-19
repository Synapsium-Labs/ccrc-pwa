// `decideMailHold`'s oracle and mutant set (mid-turn mail PR 4, plan Task 4.2). Its cases are written ONCE here, as suite
// cases over a module: `mail-hold-policy.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs
// them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MailHoldFacts } from '../../src/coord/mailHoldPolicy.js';
import type { MailHoldPair } from '../../../shared/mailHold.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type MailHoldPolicyModule = typeof import('../../src/coord/mailHoldPolicy.js');

/** The wall clock, epoch seconds. */
const NOW = 1_800_000_000;
const P7: MailHoldPair = { role: 'coordinator', delivery: 7 };
const P9: MailHoldPair = { role: 'overlord', delivery: 9 };
/** The marker the writer spells for P7 and P9 with `until` at `until`. */
const marker = (until: number, pairs = 'coordinator.7,overlord.9'): string => `${until}:${pairs}`;

/** A capable fleet, a readable route, mail enabled, P7 and P9 held, and no marker. Each case overrides a field. */
const base = (over: Partial<MailHoldFacts> = {}): MailHoldFacts => ({
  held: [P7, P9], measured: null, unreadable: false, now: NOW, capable: true, mailDisabled: false, ...over,
});

export function decideMailHoldCases(m: MailHoldPolicyModule): Record<string, SuiteCase> {
  const d = (f: MailHoldFacts) => m.decideMailHold(f);
  return {
    'a hold and no marker: write now + 300 and the pairs, as an appearance': () => {
      expect(d(base())).toEqual({ act: 'write', value: marker(NOW + 300), why: 'appear' });
    },
    'a hold and a matching marker with more than 120 s left: nothing': () => {
      expect(d(base({ measured: marker(NOW + 121) }))).toEqual({ act: 'none' });
      expect(d(base({ measured: marker(NOW + 300) }))).toEqual({ act: 'none' });
    },
    'a matching marker with exactly 120 s left is not yet renewed (fewer than 120 s renews)': () => {
      expect(d(base({ measured: marker(NOW + 120) }))).toEqual({ act: 'none' });
    },
    'the same with under 120 s left: renew to now + 300': () => {
      expect(d(base({ measured: marker(NOW + 119) }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'renew' });
      expect(d(base({ measured: marker(NOW + 1) }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'renew' });
    },
    'a matching marker that has lapsed, or reaches past now + 360, is renewed': () => {
      expect(d(base({ measured: marker(NOW) }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'renew' });
      expect(d(base({ measured: marker(NOW - 50) }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'renew' });
      expect(d(base({ measured: marker(NOW + 361) }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'renew' });
      // At exactly now + 360 the marker is live and has more than 120 s left.
      expect(d(base({ measured: marker(NOW + 360) }))).toEqual({ act: 'none' });
    },
    'a hold and a marker naming another pair: write, as a difference': () => {
      expect(d(base({ measured: marker(NOW + 300, 'coordinator.7') }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
      expect(d(base({ measured: marker(NOW + 300, 'coordinator.5,overlord.9') }))).toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
      expect(d(base({ measured: marker(NOW + 300, 'coordinator.7,overlord.9,coordinator.11') })))
        .toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
    },
    'a hold and a marker naming another role for the same delivery: write': () => {
      expect(d(base({ measured: marker(NOW + 300, 'coordinator.7,coordinator.9') })))
        .toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
    },
    'a hold and a forged value the grammar accepts but the writer never spells (unsorted): write': () => {
      expect(d(base({ measured: marker(NOW + 300, 'overlord.9,coordinator.7') })))
        .toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
    },
    'a hold and a malformed value: write': () => {
      for (const bad of ['', 'junk', `${NOW + 300}:worker.7`, `0${NOW + 300}:coordinator.7,overlord.9`, `${NOW + 300}:coordinator.7,overlord.9\n`]) {
        expect(d(base({ measured: bad })), bad).toEqual({ act: 'write', value: marker(NOW + 300), why: 'differ' });
      }
    },
    'no hold and any marker: clear, as a release': () => {
      for (const m2 of [marker(NOW + 300), marker(NOW - 10), 'junk', '']) {
        expect(d(base({ held: [], measured: m2 })), m2).toEqual({ act: 'clear', why: 'released' });
      }
    },
    'no hold and no marker: nothing': () => {
      expect(d(base({ held: [] }))).toEqual({ act: 'none' });
    },
    'more than eight held deliveries: the eight lowest, ascending': () => {
      const held: MailHoldPair[] = [12, 3, 40, 5, 1, 9, 22, 7, 15, 2].map((delivery) => ({ role: 'coordinator', delivery }));
      expect(d(base({ held }))).toEqual({ act: 'write', why: 'appear',
        value: `${NOW + 300}:${[1, 2, 3, 5, 7, 9, 12, 15].map((n) => `coordinator.${n}`).join(',')}` });
      // A marker already naming the eight lowest is matching, so a large hold renews rather than rewrites.
      const kept = `${[1, 2, 3, 5, 7, 9, 12, 15].map((n) => `coordinator.${n}`).join(',')}`;
      expect(d(base({ held, measured: `${NOW + 300}:${kept}` }))).toEqual({ act: 'none' });
    },
    'mailDisabled: clear a standing marker, write nothing': () => {
      expect(d(base({ mailDisabled: true, measured: marker(NOW + 300) }))).toEqual({ act: 'clear', why: 'mail-off' });
      expect(d(base({ mailDisabled: true, measured: 'junk' }))).toEqual({ act: 'clear', why: 'mail-off' });
      expect(d(base({ mailDisabled: true }))).toEqual({ act: 'none' });
      expect(d(base({ mailDisabled: true, held: [], measured: marker(NOW + 300) }))).toEqual({ act: 'clear', why: 'mail-off' });
    },
    'unreadable: skip, counted, never a write or a clear, whatever else holds': () => {
      expect(d(base({ unreadable: true }))).toEqual({ act: 'skip', why: 'unreadable' });
      expect(d(base({ unreadable: true, held: [] }))).toEqual({ act: 'skip', why: 'unreadable' });
      expect(d(base({ unreadable: true, mailDisabled: true }))).toEqual({ act: 'skip', why: 'unreadable' });
    },
    'not capable: skip, counted, and never "no hold"': () => {
      expect(d(base({ capable: false }))).toEqual({ act: 'skip', why: 'incapable' });
      expect(d(base({ capable: false, held: [], measured: marker(NOW + 300) }))).toEqual({ act: 'skip', why: 'incapable' });
      expect(d(base({ capable: false, mailDisabled: true, measured: marker(NOW + 300) }))).toEqual({ act: 'skip', why: 'incapable' });
    },
    'a held pair the grammar cannot spell is skipped as unrenderable, never thrown': () => {
      expect(d(base({ held: [{ role: 'worker' as never, delivery: 7 }] }))).toEqual({ act: 'skip', why: 'unrenderable' });
      expect(d(base({ held: [{ role: 'coordinator', delivery: 0 }] }))).toEqual({ act: 'skip', why: 'unrenderable' });
    },
  };
}

const DECIDE_SET: MutantSet<MailHoldPolicyModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/mailHoldPolicy.ts'),
  mutants: [
    // The plan's three (Task 4.2): drop the renewal rule, drop the clear of a forged marker, write under mailDisabled.
    { id: 'H1', old: 'if (left < MAILHOLD_RENEW_UNDER_S) return write(\'renew\');', new: '' },
    { id: 'H2', old: 'if (m.measured.slice(m.measured.indexOf(\':\') + 1) !== want.slice(want.indexOf(\':\') + 1)) return write(\'differ\');', new: '' },
    { id: 'H14', old: 'if (m.measured.slice(m.measured.indexOf(\':\') + 1) !== want.slice(want.indexOf(\':\') + 1)) return write(\'differ\');',
      new: 'if (m.measured.slice(m.measured.lastIndexOf(\',\') + 1) !== want.slice(want.lastIndexOf(\',\') + 1)) return write(\'differ\');' },
    { id: 'H3', old: "if (m.mailDisabled) return m.measured === null ? NONE : { act: 'clear', why: 'mail-off' };", new: '' },
    // The rest of the guards, one mutant each.
    { id: 'H4', old: 'if (left < MAILHOLD_RENEW_UNDER_S)', new: 'if (left <= MAILHOLD_RENEW_UNDER_S)' },
    { id: 'H5', old: "if (!mailHoldLive(parsed.hold.until, m.now)) return write('renew');", new: '' },
    { id: 'H6', old: "if (!parsed.ok) return write('differ');", new: '' },
    { id: 'H7', old: "if (!m.capable) return { act: 'skip', why: 'incapable' };", new: '' },
    { id: 'H8', old: "if (m.unreadable) return { act: 'skip', why: 'unreadable' };", new: '' },
    { id: 'H9', old: "if (m.held.length === 0) return m.measured === null ? NONE : { act: 'clear', why: 'released' };",
      new: "if (m.held.length === 0) return NONE;" },
    { id: 'H10', old: "if (m.measured === null) return write('appear');", new: "if (m.measured === null) return write('differ');" },
    { id: 'H11', old: 'renderMailHold(m.now + MAILHOLD_LEASE_S, m.held)', new: 'renderMailHold(m.now + MAILHOLD_REACH_S, m.held)' },
    { id: 'H12', old: "  } catch { return { act: 'skip', why: 'unrenderable' }; }", new: "  } catch { return NONE; }" },
    { id: 'H13', old: "if (m.mailDisabled) return m.measured === null ? NONE : { act: 'clear', why: 'mail-off' };",
      new: "if (m.mailDisabled) return NONE;" },
  ],
  suite: decideMailHoldCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const MAIL_HOLD_POLICY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/mailHoldPolicy.ts#decideMailHold': DECIDE_SET as MutantSet<never>,
};

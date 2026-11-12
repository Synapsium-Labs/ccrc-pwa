// D-8382 (#1442): Settings › Automation › Overrides in force and Settings › Security's approvals line, their pure half
// (L1): the wire guard for `GET /api/fleet/overrides` and each override's lines. Every line of a row comes from the
// switchboard's own row (`SWITCHES`, `shared/switches.ts`): its name, what it does (`meaning`), what its absence means
// (`default`) and where it stands (`switchPath`). No override is named here, and no second list of them is kept.
import { isMarkerState } from '../../../shared/api';
import { OVERRIDES_TEXT, type ApprovalsTopologyWire, type OverridesView } from '../../../shared/overrides';
import { SWITCHES, overrideSwitchNames, switchPath, type OverrideReading, type OverrideSwitchName } from '../../../shared/switches';
import { isRecord } from '../lib/wire';

const isOverrideName = (v: unknown): v is OverrideSwitchName =>
  typeof v === 'string' && (overrideSwitchNames as readonly string[]).includes(v);

function asApprovals(raw: unknown): ApprovalsTopologyWire | null {
  if (!isRecord(raw)) return null;
  const { boxes, marker, file } = raw;
  if ((boxes !== 'one' && boxes !== 'two') || (marker !== 'present' && marker !== 'absent')) return null;
  if (typeof file !== 'string' || !/^[a-z][a-z0-9-]*$/.test(file)) return null;
  return { boxes, marker, file };
}

/** The view, whole, or null. A row this build's switchboard does not have (a newer server's override) is left out, not
 *  a failure: this console cannot say what it does. */
export function asOverridesView(raw: unknown): OverridesView | null {
  if (!isRecord(raw) || !Array.isArray(raw.overrides)) return null;
  const approvals = asApprovals(raw.approvals);
  if (approvals === null) return null;
  const overrides: OverrideReading[] = [];
  for (const r of raw.overrides) {
    if (!isRecord(r) || !isMarkerState(r.state)) return null;
    if (typeof r.name !== 'string') return null;
    if (isOverrideName(r.name)) overrides.push({ name: r.name, state: r.state });
  }
  return { overrides, approvals };
}

/** One override's lines, from its switchboard row: what it does, what its absence means, and how to lift it. */
export interface OverrideLines {
  readonly name: OverrideSwitchName;
  readonly does: string;
  readonly without: string;
  readonly remedy: string;
}

/** A row's absence, without the switchboard's leading `absent: ` (every marker row's `default` starts so). */
const absenceOf = (d: string): string => d.replace(/^absent: /, '');

export function overrideLines(name: OverrideSwitchName): OverrideLines {
  const row = SWITCHES[name];
  return {
    name,
    does: row.meaning,
    without: OVERRIDES_TEXT.without.replace('{default}', absenceOf(row.default)),
    remedy: OVERRIDES_TEXT.remedy.replace('{path}', switchPath(name)),
  };
}

/** The unmeasured line for `n` rows that could not be read, or null for none. */
export function overridesUnmeasuredLine(n: number): string | null {
  return n === 0 ? null : OVERRIDES_TEXT.unmeasured.replace('{n}', String(n));
}

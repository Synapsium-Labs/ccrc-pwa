// Task 11, spec §11 "The editor sheet": name, project, prompt (`>=16px` so
// iOS never zoom-jumps — `--text-input`, never a literal), and the cadence
// picker: chips for hourly / daily / weekdays / weekly, a time field, and a
// timezone defaulting to the phone's own
// `Intl.DateTimeFormat().resolvedOptions().timeZone`. Under it, live: "next
// fire: …", recomputed locally on EVERY change — the payoff for
// `shared/schedule.ts` living in `shared/` rather than the server alone: this
// sheet imports the identical arithmetic the fire-path sweep runs, so the
// preview can never disagree with what the box will actually do.
//
// A new automation saves PAUSED (the server's own decision, spec §7 — this
// sheet sends no `state` field at all, because the create route reads none),
// and the note below the Save button says so, in the same words the arm
// door's own refusal uses (`AUTOMATION_ROUTE_REFUSAL_SENTENCE['never-run-by-hand']`)
// — one sentence, read from both places, never two spellings of the same fact.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AutomationSummary } from '../../../shared/api';
import {
  cadenceFromColumns, describeCadence, localTupleAt, nextOccurrence, type Cadence,
} from '../../../shared/schedule';
import { Sheet } from '../components/Sheet';
import { ApiError, api } from '../lib/api';
import {
  AUTOMATION_ROUTE_REFUSAL_SENTENCE, automationErrorSentence, scheduleErrorSentence,
} from './autoWords';
import './auto.css';

type ChipKind = 'hourly' | 'daily' | 'weekdays' | 'weekly';

const ALL_DAYS = 0b1111111; // every bit set — Sun..Sat
const WEEKDAYS = 0b0111110; // Mon..Fri (bit0 = Sunday, matching Date.getUTCDay)

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The single lowest set bit's index, or `1` (Monday) for a mask with none —
 *  the fallback a `weekly` chip with no prior state (a fresh create) needs. */
function lowestDayBit(days: number): number {
  for (let i = 0; i < 7; i++) if (days & (1 << i)) return i;
  return 1;
}

/** The chip a STORED cadence maps back to, for the editor's own initial
 *  state (`editing !== null`). A degraded/unrecognised stored cadence
 *  (`cadenceFromColumns`'s `{kind:'unknown'}` arm) falls back to `daily` —
 *  the same "pick the least surprising default" stance a fresh create
 *  already takes, never a crash or a blank picker. */
function chipFor(c: Cadence | { kind: 'unknown'; token: string }): ChipKind {
  if (c.kind === 'interval') return 'hourly';
  if (c.kind === 'unknown') return 'daily';
  if (c.days === ALL_DAYS) return 'daily';
  if (c.days === WEEKDAYS) return 'weekdays';
  return 'weekly';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function minuteOfDayToTime(m: number): string {
  if (!Number.isInteger(m) || m < 0 || m > 1439) return '09:00';
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** `"HH:MM"` -> minutes past local midnight, or `NaN` for anything else.
 *  `NaN` is not special-cased further here — `nextOccurrence`'s own
 *  `!Number.isInteger(c.minuteOfDay)` guard turns it into `'bad-cadence'`,
 *  which the preview already renders as a sentence (no second validation
 *  path to keep in sync with the one `shared/schedule.ts` already owns). */
function timeToMinuteOfDay(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m === null) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return NaN;
  return h * 60 + mi;
}

/** The picker's own preview sentence — `nextOccurrence` first (a typed
 *  refusal renders through the SAME sentence table the routes' own
 *  `bad-schedule` 409 uses, `scheduleErrorSentence`, never a second copy of
 *  those three words), then `localTupleAt` for the schedulable arm, guarded
 *  separately: an interval cadence carries no `tz` of its own (§4's own
 *  wire-shape rule), so this preview's `tz` field is DISPLAY-ONLY even for
 *  `hourly` — a fact this function's caller must not mistake for the stored
 *  cadence gaining a timezone it does not have. */
function previewFor(cadence: Cadence, tz: string, nowMs: number): string {
  const occ = nextOccurrence(cadence, nowMs, null);
  if ('unschedulable' in occ) {
    return `cannot schedule — ${scheduleErrorSentence(occ.unschedulable)}`;
  }
  try {
    const tup = localTupleAt(tz, occ.at);
    return `next fire: ${tup.y}-${pad2(tup.mo)}-${pad2(tup.d)} ${pad2(tup.h)}:${pad2(tup.mi)} ${tz}`;
  } catch {
    return scheduleErrorSentence('unknown-timezone');
  }
}

// NO LOCAL SENTENCE TABLE. One stood here — a "tiny local mirror" of
// `autoWords.ts`'s `scheduleErrorSentence`, argued on the grounds that
// `shared/schedule.ts`'s `CadenceUnschedulable` (3 members) is a strict
// subset by string value of `shared/api.ts`'s `ScheduleError` (5), so the
// `isScheduleError` guard would always accept. The subset argument was true
// and the conclusion was wrong: two copies of one sentence is what this tree
// forbids for the reason that had ALREADY happened here — the copies drifted
// (`bad-cadence` read "the time or interval is not well formed" locally
// against "the stored cadence is not well formed" shared), so the same
// refusal said two different things depending on which surface the operator
// was looking at. The shared table's wording is now true of both surfaces,
// and this file reads it.

export interface AutomationSheetProps {
  open: boolean;
  onClose: () => void;
  /** Fires once the create/edit round-trip actually succeeds — the caller's
   *  cue to close and let the next `{type:'automations'}` frame (or its own
   *  re-fetch) carry the new row; this sheet never merges the automation
   *  into any store itself. */
  onSaved: (automation: AutomationSummary) => void;
  /** `null`/absent — create. Present — edit that row. */
  editing?: AutomationSummary | null;
  createAutomation?: typeof api.createAutomation;
  editAutomation?: typeof api.editAutomation;
  /** Injectable clock for the preview — same reason every ladder-shaped
   *  decision in this repo takes `now` as a parameter rather than calling
   *  `Date.now()` inside: a test can hold it fixed. */
  now?: () => number;
  /** Injectable IANA zone default — same reason `now` is: a test must not
   *  depend on the runner's own `Intl` default. */
  defaultTz?: string;
}

/**
 * FRESH ON EVERY OPEN, AND ON EVERY TARGET. The form's `useState`
 * initialisers run once per MOUNT, and this component is mounted for the life
 * of the screen that owns it — so with the state held out here, a second open
 * re-showed the first open's half-typed form, and once the edit door existed
 * it would have shown one row's values under another row's title.
 *
 * TWO mechanisms, because there are two ways to reach a stale form, and each
 * is measured separately:
 *   * the state lives in the FORM, which the drawer unmounts when it closes —
 *     so a close and reopen is a fresh mount with the initialisers re-run,
 *     with ONE copy of the initial-state policy rather than eight assignments;
 *   * the `key` covers a target that changes while the sheet stays OPEN,
 *     which no unmount would catch.
 *
 * The generation is bumped in a RENDER-PHASE adjust (React's documented
 * "adjusting state when props change") rather than in an effect, so the fresh
 * form is what commits — an effect would paint the stale one for a frame
 * first, and the stale frame IS the defect.
 */
export function AutomationSheet(props: AutomationSheetProps): ReactNode {
  const { open, onClose, editing = null } = props;
  const [gen, setGen] = useState(0);
  const wasOpen = useRef(open);
  if (wasOpen.current !== open) {
    wasOpen.current = open;
    if (open) setGen((g) => g + 1);
  }
  return (
    <Sheet open={open} onClose={onClose} title={editing === null ? 'New automation' : 'Edit automation'}>
      <AutomationSheetForm key={`${gen}:${editing === null ? 'new' : String(editing.id)}`} {...props} />
    </Sheet>
  );
}

function AutomationSheetForm({
  onClose,
  onSaved,
  editing = null,
  createAutomation = api.createAutomation,
  editAutomation = api.editAutomation,
  now = () => Date.now(),
  defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: AutomationSheetProps): ReactNode {
  const initialCadence = editing === null ? null : cadenceFromColumns(editing);

  const [name, setName] = useState(editing?.name ?? '');
  const [project, setProject] = useState(editing?.project ?? '');
  const [prompt, setPrompt] = useState(editing?.prompt ?? '');
  const [chip, setChip] = useState<ChipKind>(initialCadence === null ? 'daily' : chipFor(initialCadence));
  const [timeStr, setTimeStr] = useState(
    initialCadence !== null && initialCadence.kind === 'wall-clock'
      ? minuteOfDayToTime(initialCadence.minuteOfDay) : '09:00',
  );
  const [weeklyDay, setWeeklyDay] = useState(
    initialCadence !== null && initialCadence.kind === 'wall-clock' ? lowestDayBit(initialCadence.days) : 1,
  );
  const [tz, setTz] = useState(
    initialCadence !== null && initialCadence.kind === 'wall-clock' ? initialCadence.tz : defaultTz,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cadence: Cadence =
    chip === 'hourly'
      ? { kind: 'interval', everyMinutes: 60 }
      : {
          kind: 'wall-clock',
          days: chip === 'daily' ? ALL_DAYS : chip === 'weekdays' ? WEEKDAYS : (1 << weeklyDay),
          minuteOfDay: timeToMinuteOfDay(timeStr),
          tz,
        };
  const preview = previewFor(cadence, tz, now());

  const onSave = (): void => {
    setSaveError(null);
    setSaving(true);
    const body = { name, project, prompt, cadence };
    const call = editing === null ? createAutomation(body) : editAutomation(editing.id, body);
    call.then((res) => {
      setSaving(false);
      onSaved(res.automation);
      onClose();
    }).catch((err: unknown) => {
      setSaving(false);
      setSaveError(err instanceof ApiError ? automationErrorSentence(err.body) : String(err));
    });
  };

  return (
      <div className="auto-sheet">
        <label className="auto-sheet-field">
          <span>Name</span>
          <input className="auto-sheet-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="auto-sheet-field">
          <span>Project</span>
          <input className="auto-sheet-input" value={project} onChange={(e) => setProject(e.target.value)} />
        </label>
        <label className="auto-sheet-field">
          <span>Prompt</span>
          <textarea
            className="auto-sheet-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <div className="auto-cadence-chips" role="group" aria-label="cadence">
          {(['hourly', 'daily', 'weekdays', 'weekly'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="auto-cadence-chip"
              aria-pressed={chip === k}
              data-selected={chip === k}
              onClick={() => setChip(k)}
            >
              {k}
            </button>
          ))}
        </div>

        {chip !== 'hourly' && (
          <>
            <label className="auto-sheet-field">
              <span>Time</span>
              <input
                type="time"
                className="auto-cadence-time"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
              />
            </label>
            {chip === 'weekly' && (
              <label className="auto-sheet-field">
                <span>Day</span>
                <select
                  className="auto-cadence-day"
                  value={weeklyDay}
                  onChange={(e) => setWeeklyDay(Number(e.target.value))}
                >
                  {DAY_LABEL.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="auto-sheet-field">
              <span>Timezone</span>
              <input className="auto-cadence-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
            </label>
          </>
        )}

        <p className="auto-sheet-preview" data-preview="true">{preview}</p>

        {editing === null && (
          <p className="auto-sheet-note">
            Saves paused — {AUTOMATION_ROUTE_REFUSAL_SENTENCE['never-run-by-hand']}.
          </p>
        )}

        {saveError !== null && <p className="auto-sheet-error" role="alert">{saveError}</p>}

        <button type="button" className="auto-sheet-save" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
  );
}

// Re-exported so a test can pin the exact prose the picker composed for a
// cadence, without either re-implementing `describeCadence` or asserting on
// the whole sheet's rendered text — kept for future callers (the list row
// uses `describeCadence` directly off the stored columns).
export { describeCadence };

// Settings › Automation › Coordinator advisor (plan 2026-11-23-coordinator-advisor PR B and D; D-8967): Off, Opus or Fable,
// the daily call cap per coordinator, and which coordinators (every one, or named sessions: a trial needs no code). The card
// reads its own door (`GET /api/coord/coordinator-advisor`) and writes it (`POST`); the answer is the line under the group
// (`useResultLine`), as every Settings write's is. Its summary lists every coordinator the advisor touches, in the words the
// session header uses (`advisorLineOf`, the one reader of `FleetSession.advisor`). Like Auto memory for plain sessions, it
// says it moves no session until the Launch profiles lane reads live. Every word is L0's but the not-available line.
import { useEffect, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Button, Section } from '@ccrc/ui';
import {
  ADVISOR_CAP_MAX, ADVISOR_CAP_MIN, ADVISOR_CHOICES, COORDINATOR_ADVISOR_TEXT as T, isAdvisorCap,
  type AdvisorChoice, type CoordinatorAdvisorSetting, type CoordinatorAdvisorView,
} from '../../../shared/coordinatorAdvisor';
import { LAUNCH_PROFILE_LANE } from '../../../shared/lane-arm';
import { api } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { advisorLineOf, asCoordinatorAdvisorView } from './advisorWords';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { asLaneArmView } from './laneArmWords';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_WHEN, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';

/** One labelled input of the card (the cap, the scope): the label's words, then the field. */
function Field({ label, value, onChange, disabled, input }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean; input: InputHTMLAttributes<HTMLInputElement>;
}): ReactNode {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input {...input} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

type Read = { kind: 'loading' } | { kind: 'view'; view: CoordinatorAdvisorView } | { kind: 'unavailable' };

/** The ids field's text as a scope: blank is every coordinator; otherwise the ids it names, split on spaces or commas. */
function scopeOfText(text: string): CoordinatorAdvisorSetting['scope'] {
  const ids = text.split(/[\s,]+/).filter((x) => x !== '');
  return ids.length === 0 ? { kind: 'all' } : { kind: 'sessions', ids };
}

export function CoordinatorAdvisorSection({ store = useFleetStore }: { store?: FleetStore } = {}): ReactNode {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [laneLive, setLaneLive] = useState(false);
  const [capText, setCapText] = useState('');
  const [idsText, setIdsText] = useState('');
  const result = useResultLine();
  const card = SETTINGS_CARDS.automation.coordinatorAdvisor;
  const sessions = store((s) => s.sessions);

  const showView = (view: CoordinatorAdvisorView): void => {
    setRead({ kind: 'view', view });
    const s = view.setting ?? view.default;
    setCapText(String(s.cap));
    setIdsText(s.scope.kind === 'all' ? '' : s.scope.ids.join(' '));
  };

  useEffect(() => {
    let live = true;
    api.coordinatorAdvisor().then((raw) => {
      if (!live) return;
      const view = asCoordinatorAdvisorView(raw);
      if (view === null) setRead({ kind: 'unavailable' }); else showView(view);
    }, () => { if (live) setRead({ kind: 'unavailable' }); });
    api.laneArm().then((raw) => {
      if (live) setLaneLive(asLaneArmView(raw)?.lanes.some((r) => r.lane === LAUNCH_PROFILE_LANE && r.live) ?? false);
    }, () => {});
    return () => { live = false; };
  }, []);

  const current = read.kind === 'view' ? read.view.setting : null;
  const save = async (choice: AdvisorChoice): Promise<void> => {
    if (saving) return;
    result.clear();
    const cap = Number(capText);
    if (!isAdvisorCap(cap)) { result.say(`${T.capLabel}: ${ADVISOR_CAP_MIN} to ${ADVISOR_CAP_MAX}.`, 'refusal'); return; }
    setSaving(true);
    try {
      const answer = await api.setCoordinatorAdvisor({ choice, cap, scope: scopeOfText(idsText) });
      const view = answer === 'unreadable' ? null : asCoordinatorAdvisorView(answer);
      if (view === null || view.setting === null) result.say(UNCONFIRMED_TEXT);
      else showView(view);
    } catch (err) {
      result.say(err instanceof Error ? err.message : String(err), 'refusal');
    } finally {
      setSaving(false);
    }
  };

  const summary = sessions.flatMap((s) => {
    const line = advisorLineOf(s.advisor);
    return line === null ? [] : [{ id: s.id, line }];
  });

  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {read.kind === 'unavailable' ? <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p> : (
        <>
          {read.kind === 'view' && current === null && <p className={SETTINGS_AMBER_NOTE}>{T.unread}</p>}
          <Field label={T.capLabel} value={capText} onChange={setCapText} disabled={saving || read.kind === 'loading'}
            input={{ type: 'number', inputMode: 'numeric', min: ADVISOR_CAP_MIN, max: ADVISOR_CAP_MAX }} />
          <Field label={`${T.scopeLabel}: ${idsText.trim() === '' ? T.scopeAll : T.scopeSessions}`} value={idsText} onChange={setIdsText}
            disabled={saving || read.kind === 'loading'} input={{ type: 'text', placeholder: T.scopeAll, 'aria-label': T.scopeSessions }} />
          {/* The radio saves on a pick only; a cap or a list edited under the standing choice is saved here (review F7). */}
          {current !== null && (
            <Button variant="ghost" disabled={saving || read.kind === 'loading'} onClick={() => void save(current.choice)}>{T.save}</Button>
          )}
          <NotedRadioSet
            legend={T.legend}
            name="settings-coordinator-advisor"
            options={ADVISOR_CHOICES.map((c) => ({ value: c, label: T.choices[c], note: T.notes[c] }))}
            value={current?.choice ?? null}
            onPick={(c) => void save(c)}
            disabled={saving || read.kind === 'loading'}
          />
          {summary.length > 0 && (
            <ul className="settings-note" aria-label={T.legend}>
              {summary.map(({ id, line }) => <li key={id} title={line.title}>{`${id}: ${line.text}`}</li>)}
            </ul>
          )}
        </>
      )}
      <ResultLine line={result.line} />
      {!laneLive && <p className={SETTINGS_WHEN}>{T.shadow}</p>}
    </Section>
  );
}
